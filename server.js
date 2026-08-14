const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { getPool } = require('./db');
const { generateToken, verifyToken, isAdmin, isStudent } = require('./middleware/auth');
const { logAudit } = require('./middleware/audit');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for memory buffer (CSV upload)
const upload = multer({ storage: multer.memoryStorage() });

// ----------------- ROOT -----------------
app.get('/', (req, res) => {
  res.json({ message: 'AttendIQ API Server v2.0 is running 🚀' });
});

// ----------------- AUTHENTICATION -----------------

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const pool = await getPool();
    const [users] = await pool.query(
      `SELECT * FROM users WHERE username = ? LIMIT 1`,
      [username.trim()]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact Administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = generateToken(user);
    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        roll_no: user.roll_no,
        department: user.department
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error during authentication.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// ----------------- ADMIN ROUTES -----------------

// GET /api/admin/students?semester_id=
app.get('/api/admin/students', verifyToken, isAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const { semester_id } = req.query;

    if (semester_id) {
      const [students] = await pool.query(
        `SELECT u.id, u.username, u.full_name, u.roll_no, u.department, u.is_active, e.created_at as enrolled_at
         FROM users u
         JOIN enrollments e ON u.id = e.student_id
         WHERE e.semester_id = ? AND u.role = 'student' AND u.is_active = 1
         ORDER BY u.roll_no ASC, u.full_name ASC`,
        [semester_id]
      );
      return res.json(students);
    } else {
      const [students] = await pool.query(
        `SELECT u.id, u.username, u.full_name, u.roll_no, u.department, u.is_active
         FROM users u
         WHERE u.role = 'student'
         ORDER BY u.roll_no ASC, u.full_name ASC`
      );
      return res.json(students);
    }
  } catch (err) {
    console.error('Get students error:', err);
    res.status(500).json({ error: 'Failed to fetch students.' });
  }
});

// POST /api/admin/attendance
// Body: { semester_id, subject_id, date, records: [{ student_id, status, absence_reason, reason_note }] }
app.post('/api/admin/attendance', verifyToken, isAdmin, async (req, res) => {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    const { semester_id, subject_id, date, records } = req.body;
    if (!semester_id || !subject_id || !date || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Missing required attendance fields.' });
    }

    await connection.beginTransaction();

    for (const rec of records) {
      const { student_id, status, absence_reason, reason_note } = rec;
      const finalReason = status === 'absent' ? (absence_reason || 'normal_absent') : null;
      const finalNote = status === 'absent' ? (reason_note || null) : null;

      await connection.query(
        `INSERT INTO attendance (student_id, subject_id, semester_id, date, status, absence_reason, reason_note, marked_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           absence_reason = VALUES(absence_reason),
           reason_note = VALUES(reason_note),
           marked_by = VALUES(marked_by)`,
        [student_id, subject_id, semester_id, date, status, finalReason, finalNote, req.user.id]
      );
    }

    await connection.commit();

    await logAudit(
      pool,
      req.user.id,
      'MARK_ATTENDANCE',
      'attendance',
      null,
      `Marked attendance for subject_id: ${subject_id}, semester_id: ${semester_id}, date: ${date}, total records: ${records.length}`
    );

    res.json({ message: 'Attendance marked successfully.' });
  } catch (err) {
    await connection.rollback();
    console.error('Mark attendance error:', err);
    res.status(500).json({ error: 'Failed to save attendance transaction.' });
  } finally {
    connection.release();
  }
});

// GET /api/admin/report/:studentId?semester_id=
app.get('/api/admin/report/:studentId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    // Student Info
    const [userRows] = await pool.query(
      `SELECT id, username, full_name, roll_no, department FROM users WHERE id = ? AND role = 'student'`,
      [studentId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    // Attendance stats per subject
    const [subjectStats] = await pool.query(
      `SELECT sub.id as subject_id, sub.subject_name,
              COUNT(a.id) as total_classes,
              SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as attended_classes,
              SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_classes
       FROM subjects sub
       LEFT JOIN attendance a ON a.subject_id = sub.id AND a.student_id = ? AND a.semester_id = ?
       WHERE sub.semester_id = ?
       GROUP BY sub.id, sub.subject_name`,
      [studentId, semester_id, semester_id]
    );

    let overallTotal = 0;
    let overallAttended = 0;
    let overallAbsent = 0;

    const subjects = subjectStats.map(s => {
      const total = parseInt(s.total_classes || 0);
      const attended = parseInt(s.attended_classes || 0);
      const absent = parseInt(s.absent_classes || 0);
      const percentage = total > 0 ? ((attended / total) * 100).toFixed(1) : 0;

      overallTotal += total;
      overallAttended += attended;
      overallAbsent += absent;

      return {
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        total_classes: total,
        attended_classes: attended,
        absent_classes: absent,
        percentage: parseFloat(percentage)
      };
    });

    const overallPercentage = overallTotal > 0 ? ((overallAttended / overallTotal) * 100).toFixed(1) : 0;

    res.json({
      student: userRows[0],
      overall: {
        total_classes: overallTotal,
        attended_classes: overallAttended,
        absent_classes: overallAbsent,
        percentage: parseFloat(overallPercentage)
      },
      subjects
    });
  } catch (err) {
    console.error('Admin student report error:', err);
    res.status(500).json({ error: 'Failed to fetch student report.' });
  }
});

// GET /api/admin/report/:studentId/absences?semester_id=
app.get('/api/admin/report/:studentId/absences', verifyToken, isAdmin, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    const [absences] = await pool.query(
      `SELECT a.id, a.date, a.absence_reason, a.reason_note, sub.subject_name, u.full_name as marked_by_name
       FROM attendance a
       JOIN subjects sub ON a.subject_id = sub.id
       JOIN users u ON a.marked_by = u.id
       WHERE a.student_id = ? AND a.semester_id = ? AND a.status = 'absent'
       ORDER BY a.date DESC`,
      [studentId, semester_id]
    );

    res.json(absences);
  } catch (err) {
    console.error('Admin student absences error:', err);
    res.status(500).json({ error: 'Failed to fetch absent records.' });
  }
});

// GET /api/admin/overview?semester_id=
app.get('/api/admin/overview', verifyToken, isAdmin, async (req, res) => {
  try {
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    // 1. Total Enrolled Students
    const [[{ enrolledCount }]] = await pool.query(
      `SELECT COUNT(*) as enrolledCount FROM enrollments WHERE semester_id = ?`,
      [semester_id]
    );

    // 2. Overall attendance records in semester
    const [[{ totalRecords, totalPresent, totalAbsent }]] = await pool.query(
      `SELECT COUNT(*) as totalRecords,
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as totalPresent,
              SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as totalAbsent
       FROM attendance WHERE semester_id = ?`,
      [semester_id]
    );

    const averagePercentage = totalRecords > 0 ? ((totalPresent / totalRecords) * 100).toFixed(1) : 0;

    // 3. Breakdown of absence reasons
    const [reasonBreakdown] = await pool.query(
      `SELECT absence_reason, COUNT(*) as count
       FROM attendance
       WHERE semester_id = ? AND status = 'absent'
       GROUP BY absence_reason`,
      [semester_id]
    );

    // 4. Students below 75% attendance
    const [studentStats] = await pool.query(
      `SELECT u.id, u.full_name, u.roll_no, u.department,
              COUNT(a.id) as total_classes,
              SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as attended_classes
       FROM enrollments e
       JOIN users u ON e.student_id = u.id
       LEFT JOIN attendance a ON a.student_id = u.id AND a.semester_id = ?
       WHERE e.semester_id = ? AND u.is_active = 1
       GROUP BY u.id`,
      [semester_id, semester_id]
    );

    let lowAttendanceCount = 0;
    const lowAttendanceList = [];

    studentStats.forEach(s => {
      const tot = parseInt(s.total_classes || 0);
      const att = parseInt(s.attended_classes || 0);
      const pct = tot > 0 ? (att / tot) * 100 : 100;
      if (pct < 75 && tot > 0) {
        lowAttendanceCount++;
        const classesNeeded = Math.ceil((0.75 * tot - att) / 0.25);
        lowAttendanceList.push({
          id: s.id,
          full_name: s.full_name,
          roll_no: s.roll_no,
          department: s.department,
          total_classes: tot,
          attended_classes: att,
          percentage: parseFloat(pct.toFixed(1)),
          classes_needed: classesNeeded
        });
      }
    });

    lowAttendanceList.sort((a, b) => b.classes_needed - a.classes_needed);

    res.json({
      enrolled_students: parseInt(enrolledCount || 0),
      total_records: parseInt(totalRecords || 0),
      average_percentage: parseFloat(averagePercentage),
      low_attendance_count: lowAttendanceCount,
      absence_reasons: reasonBreakdown,
      low_attendance_students: lowAttendanceList
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'Failed to fetch overview analytics.' });
  }
});

// ----------------- USER MANAGEMENT -----------------

// GET /api/admin/users
app.get('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const [users] = await pool.query(
      `SELECT id, username, role, full_name, roll_no, department, is_active, created_at
       FROM users ORDER BY role ASC, id DESC`
    );
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// POST /api/admin/users (Create student/admin)
app.post('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const { username, password, role, full_name, roll_no, department, semester_id } = req.body;

    if (!username || !password || !role || !full_name) {
      return res.status(400).json({ error: 'Missing required user fields.' });
    }

    const pool = await getPool();

    // Check existing username
    const [existing] = await pool.query(`SELECT id FROM users WHERE username = ?`, [username.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (username, password_hash, role, full_name, roll_no, department, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [username.trim(), password_hash, role, full_name.trim(), roll_no || null, department || null]
    );

    const newUserId = result.insertId;

    // Enroll student in semester if specified
    if (role === 'student' && semester_id) {
      await pool.query(
        `INSERT IGNORE INTO enrollments (student_id, semester_id) VALUES (?, ?)`,
        [newUserId, semester_id]
      );
    }

    await logAudit(pool, req.user.id, 'CREATE_USER', 'users', newUserId, { username, role, full_name });

    res.status(201).json({ message: 'User created successfully.', id: newUserId });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// PUT /api/admin/users/:id (Edit/deactivate/reset password)
app.put('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, roll_no, department, is_active, password } = req.body;
    const pool = await getPool();

    const updates = [];
    const values = [];

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(full_name);
    }
    if (roll_no !== undefined) {
      updates.push('roll_no = ?');
      values.push(roll_no);
    }
    if (department !== undefined) {
      updates.push('department = ?');
      values.push(department);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(password_hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    await logAudit(pool, req.user.id, 'UPDATE_USER', 'users', id, req.body);

    res.json({ message: 'User updated successfully.' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// POST /api/admin/users/bulk-import (CSV Upload or JSON Payload)
app.post('/api/admin/users/bulk-import', verifyToken, isAdmin, upload.single('csv_file'), async (req, res) => {
  try {
    let rows = [];
    const pool = await getPool();

    if (req.file) {
      const csvText = req.file.buffer.toString('utf-8');
      const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
      
      if (lines.length <= 1) {
        return res.status(400).json({ error: 'CSV file is empty or missing data rows.' });
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const rollIdx = headers.findIndex(h => h.includes('roll'));
      const nameIdx = headers.findIndex(h => h.includes('name'));
      const usernameIdx = headers.findIndex(h => h.includes('user'));
      const deptIdx = headers.findIndex(h => h.includes('dept') || h.includes('department'));

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length >= 2) {
          const roll_no = rollIdx !== -1 ? cols[rollIdx] : `R${1000 + i}`;
          const full_name = nameIdx !== -1 ? cols[nameIdx] : cols[0];
          const username = usernameIdx !== -1 ? cols[usernameIdx] : (roll_no ? roll_no.toLowerCase() : `user${i}`);
          const department = deptIdx !== -1 ? cols[deptIdx] : 'General';
          rows.push({ roll_no, full_name, username, department });
        }
      }
    } else if (Array.isArray(req.body.students)) {
      rows = req.body.students;
    } else {
      return res.status(400).json({ error: 'No CSV file or student records provided.' });
    }

    const { semester_id } = req.body;
    const defaultPassword = 'Student@123';
    const defaultHash = await bcrypt.hash(defaultPassword, 10);

    let importedCount = 0;
    let skippedCount = 0;

    for (const s of rows) {
      if (!s.username || !s.full_name) continue;
      try {
        const [res] = await pool.query(
          `INSERT INTO users (username, password_hash, role, full_name, roll_no, department, is_active)
           VALUES (?, ?, 'student', ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), roll_no = VALUES(roll_no), department = VALUES(department)`,
          [s.username.trim(), defaultHash, s.full_name.trim(), s.roll_no || null, s.department || null]
        );

        let studentId = res.insertId;
        if (!studentId) {
          const [[user]] = await pool.query(`SELECT id FROM users WHERE username = ?`, [s.username.trim()]);
          studentId = user ? user.id : null;
        }

        if (studentId && semester_id) {
          await pool.query(
            `INSERT IGNORE INTO enrollments (student_id, semester_id) VALUES (?, ?)`,
            [studentId, semester_id]
          );
        }
        importedCount++;
      } catch (e) {
        skippedCount++;
      }
    }

    await logAudit(pool, req.user.id, 'BULK_IMPORT_USERS', 'users', null, { importedCount, skippedCount });

    res.json({
      message: `Bulk import completed. ${importedCount} students processed, ${skippedCount} skipped.`,
      importedCount,
      skippedCount
    });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: 'Failed to process bulk import.' });
  }
});

// ----------------- SEMESTER & SUBJECT MANAGEMENT -----------------

// GET /api/admin/semesters
app.get('/api/admin/semesters', verifyToken, async (req, res) => {
  try {
    const pool = await getPool();
    const [semesters] = await pool.query(
      `SELECT * FROM semesters ORDER BY semester_number ASC`
    );
    res.json(semesters);
  } catch (err) {
    console.error('Get semesters error:', err);
    res.status(500).json({ error: 'Failed to fetch semesters.' });
  }
});

// POST /api/admin/semesters
app.post('/api/admin/semesters', verifyToken, isAdmin, async (req, res) => {
  try {
    const { semester_number, start_date, end_date, is_active } = req.body;
    if (!semester_number || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required semester fields.' });
    }

    const pool = await getPool();

    if (is_active) {
      await pool.query(`UPDATE semesters SET is_active = 0`);
    }

    const [result] = await pool.query(
      `INSERT INTO semesters (semester_number, start_date, end_date, is_active) VALUES (?, ?, ?, ?)`,
      [semester_number, start_date, end_date, is_active ? 1 : 0]
    );

    await logAudit(pool, req.user.id, 'CREATE_SEMESTER', 'semesters', result.insertId, req.body);

    res.status(201).json({ message: 'Semester created successfully.', id: result.insertId });
  } catch (err) {
    console.error('Create semester error:', err);
    res.status(500).json({ error: 'Failed to create semester.' });
  }
});

// PUT /api/admin/semesters/:id
app.put('/api/admin/semesters/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { semester_number, start_date, end_date, is_active } = req.body;
    const pool = await getPool();

    if (is_active) {
      await pool.query(`UPDATE semesters SET is_active = 0 WHERE id != ?`, [id]);
    }

    await pool.query(
      `UPDATE semesters SET semester_number = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?`,
      [semester_number, start_date, end_date, is_active ? 1 : 0, id]
    );

    await logAudit(pool, req.user.id, 'UPDATE_SEMESTER', 'semesters', id, req.body);

    res.json({ message: 'Semester updated successfully.' });
  } catch (err) {
    console.error('Update semester error:', err);
    res.status(500).json({ error: 'Failed to update semester.' });
  }
});

// GET /api/admin/subjects?semester_id=
app.get('/api/admin/subjects', verifyToken, async (req, res) => {
  try {
    const { semester_id } = req.query;
    const pool = await getPool();

    let query = `
      SELECT s.id, s.semester_id, s.subject_name, s.assigned_admin_id, u.full_name as assigned_admin_name
      FROM subjects s
      LEFT JOIN users u ON s.assigned_admin_id = u.id
    `;
    const params = [];

    if (semester_id) {
      query += ` WHERE s.semester_id = ?`;
      params.push(semester_id);
    }
    query += ` ORDER BY s.id DESC`;

    const [subjects] = await pool.query(query, params);
    res.json(subjects);
  } catch (err) {
    console.error('Get subjects error:', err);
    res.status(500).json({ error: 'Failed to fetch subjects.' });
  }
});

// POST /api/admin/subjects
app.post('/api/admin/subjects', verifyToken, isAdmin, async (req, res) => {
  try {
    const { semester_id, subject_name, assigned_admin_id } = req.body;
    if (!semester_id || !subject_name) {
      return res.status(400).json({ error: 'Missing required subject fields.' });
    }

    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO subjects (semester_id, subject_name, assigned_admin_id) VALUES (?, ?, ?)`,
      [semester_id, subject_name.trim(), assigned_admin_id || req.user.id]
    );

    await logAudit(pool, req.user.id, 'CREATE_SUBJECT', 'subjects', result.insertId, req.body);

    res.status(201).json({ message: 'Subject added successfully.', id: result.insertId });
  } catch (err) {
    console.error('Create subject error:', err);
    res.status(500).json({ error: 'Failed to add subject.' });
  }
});

// PUT /api/admin/subjects/:id
app.put('/api/admin/subjects/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { subject_name, assigned_admin_id } = req.body;
    const pool = await getPool();

    await pool.query(
      `UPDATE subjects SET subject_name = ?, assigned_admin_id = ? WHERE id = ?`,
      [subject_name.trim(), assigned_admin_id || null, id]
    );

    await logAudit(pool, req.user.id, 'UPDATE_SUBJECT', 'subjects', id, req.body);

    res.json({ message: 'Subject updated successfully.' });
  } catch (err) {
    console.error('Update subject error:', err);
    res.status(500).json({ error: 'Failed to update subject.' });
  }
});

// POST /api/admin/enrollments (Enroll / Unenroll students)
app.post('/api/admin/enrollments', verifyToken, isAdmin, async (req, res) => {
  try {
    const { student_ids, semester_id, action } = req.body; // action: 'enroll' | 'unenroll'
    if (!Array.isArray(student_ids) || !semester_id || !action) {
      return res.status(400).json({ error: 'Missing enrollment parameters.' });
    }

    const pool = await getPool();

    if (action === 'enroll') {
      for (const student_id of student_ids) {
        await pool.query(
          `INSERT IGNORE INTO enrollments (student_id, semester_id) VALUES (?, ?)`,
          [student_id, semester_id]
        );
      }
    } else if (action === 'unenroll') {
      for (const student_id of student_ids) {
        await pool.query(
          `DELETE FROM enrollments WHERE student_id = ? AND semester_id = ?`,
          [student_id, semester_id]
        );
      }
    }

    await logAudit(pool, req.user.id, `ENROLLMENT_${action.toUpperCase()}`, 'enrollments', null, { student_ids, semester_id, action });

    res.json({ message: `Enrollment status updated for ${student_ids.length} students.` });
  } catch (err) {
    console.error('Enrollment update error:', err);
    res.status(500).json({ error: 'Failed to update enrollments.' });
  }
});

// ----------------- AUDIT LOG -----------------

// GET /api/admin/audit-log
app.get('/api/admin/audit-log', verifyToken, isAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const [logs] = await pool.query(
      `SELECT a.id, a.action_type, a.target_table, a.target_id, a.details, a.created_at, u.username as admin_username, u.full_name as admin_name
       FROM audit_log a
       JOIN users u ON a.admin_id = u.id
       ORDER BY a.id DESC LIMIT 100`
    );
    res.json(logs);
  } catch (err) {
    console.error('Get audit log error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ----------------- STUDENT ROUTES (VIEW ONLY) -----------------

// GET /api/student/subjects?semester_id= (their enrolled subjects, admin-assigned)
app.get('/api/student/subjects', verifyToken, isStudent, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    // Check if student is enrolled in this semester
    const [enrollment] = await pool.query(
      `SELECT id FROM enrollments WHERE student_id = ? AND semester_id = ?`,
      [studentId, semester_id]
    );

    if (enrollment.length === 0) {
      return res.json([]);
    }

    // Return enrolled subjects for this semester with assigned admin name
    const [subjects] = await pool.query(
      `SELECT s.id, s.semester_id, s.subject_name, s.assigned_admin_id, u.full_name as assigned_admin_name
       FROM subjects s
       LEFT JOIN users u ON s.assigned_admin_id = u.id
       WHERE s.semester_id = ?
       ORDER BY s.subject_name ASC`,
      [semester_id]
    );

    res.json(subjects);
  } catch (err) {
    console.error('Get student subjects error:', err);
    res.status(500).json({ error: 'Failed to fetch student subjects.' });
  }
});

// GET /api/student/report?semester_id=
app.get('/api/student/report', verifyToken, isStudent, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    // Attendance stats per subject
    const [subjectStats] = await pool.query(
      `SELECT sub.id as subject_id, sub.subject_name,
              COUNT(a.id) as total_classes,
              SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as attended_classes,
              SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_classes
       FROM subjects sub
       LEFT JOIN attendance a ON a.subject_id = sub.id AND a.student_id = ? AND a.semester_id = ?
       WHERE sub.semester_id = ?
       GROUP BY sub.id, sub.subject_name`,
      [studentId, semester_id, semester_id]
    );

    let overallTotal = 0;
    let overallAttended = 0;
    let overallAbsent = 0;

    const subjects = subjectStats.map(s => {
      const total = parseInt(s.total_classes || 0);
      const attended = parseInt(s.attended_classes || 0);
      const absent = parseInt(s.absent_classes || 0);
      const percentage = total > 0 ? ((attended / total) * 100).toFixed(1) : 0;

      overallTotal += total;
      overallAttended += attended;
      overallAbsent += absent;

      return {
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        total_classes: total,
        attended_classes: attended,
        absent_classes: absent,
        percentage: parseFloat(percentage)
      };
    });

    const overallPercentage = overallTotal > 0 ? ((overallAttended / overallTotal) * 100).toFixed(1) : 0;

    res.json({
      student: {
        id: req.user.id,
        full_name: req.user.full_name,
        roll_no: req.user.roll_no,
        department: req.user.department
      },
      overall: {
        total_classes: overallTotal,
        attended_classes: overallAttended,
        absent_classes: overallAbsent,
        percentage: parseFloat(overallPercentage)
      },
      subjects
    });
  } catch (err) {
    console.error('Student report error:', err);
    res.status(500).json({ error: 'Failed to fetch student report.' });
  }
});

// GET /api/student/absences?semester_id=
app.get('/api/student/absences', verifyToken, isStudent, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    const [absences] = await pool.query(
      `SELECT a.id, a.date, a.absence_reason, a.reason_note, sub.subject_name
       FROM attendance a
       JOIN subjects sub ON a.subject_id = sub.id
       WHERE a.student_id = ? AND a.semester_id = ? AND a.status = 'absent'
       ORDER BY a.date DESC`,
      [studentId, semester_id]
    );

    res.json(absences);
  } catch (err) {
    console.error('Student absences error:', err);
    res.status(500).json({ error: 'Failed to fetch absent records.' });
  }
});

// GET /api/student/projection?semester_id= (75% Calculator)
app.get('/api/student/projection', verifyToken, isStudent, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { semester_id } = req.query;
    const pool = await getPool();

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required.' });
    }

    const [[{ total_classes, attended_classes }]] = await pool.query(
      `SELECT COUNT(id) as total_classes,
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as attended_classes
       FROM attendance
       WHERE student_id = ? AND semester_id = ?`,
      [studentId, semester_id]
    );

    const total = parseInt(total_classes || 0);
    const attended = parseInt(attended_classes || 0);
    const currentPct = total > 0 ? (attended / total) * 100 : 0;

    let targetMet = currentPct >= 75;
    let classesNeeded = 0;
    let classesBunkable = 0;

    if (total === 0) {
      targetMet = true;
    } else if (currentPct < 75) {
      // Find smallest x such that (attended + x) / (total + x) >= 0.75
      // 0.25 * x >= 0.75 * total - attended => x >= (0.75 * total - attended) / 0.25
      classesNeeded = Math.ceil((0.75 * total - attended) / 0.25);
    } else {
      // Find largest y such that attended / (total + y) >= 0.75
      // attended >= 0.75 * total + 0.75 * y => 0.75 * y <= attended - 0.75 * total => y <= (attended - 0.75 * total) / 0.75
      classesBunkable = Math.floor((attended - 0.75 * total) / 0.75);
    }

    res.json({
      total_classes: total,
      attended_classes: attended,
      current_percentage: parseFloat(currentPct.toFixed(1)),
      target_met: targetMet,
      classes_needed: classesNeeded,
      classes_bunkable: classesBunkable
    });
  } catch (err) {
    console.error('Student projection error:', err);
    res.status(500).json({ error: 'Failed to calculate projection.' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 AttendIQ Express Server listening on http://localhost:${PORT}`);
});
