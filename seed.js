const bcrypt = require('bcryptjs');
const { getPool } = require('./db');

async function seedDemoData() {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    console.log('🌱 Seeding demo data into AttendIQ database...');

    // 1. Ensure Active Semester 1 exists
    let [semRows] = await connection.query(`SELECT id FROM semesters WHERE semester_number = 1 LIMIT 1`);
    let semId;
    if (semRows.length === 0) {
      const [res] = await connection.query(
        `INSERT INTO semesters (semester_number, start_date, end_date, is_active) VALUES (1, '2026-01-01', '2026-06-30', 1)`
      );
      semId = res.insertId;
    } else {
      semId = semRows[0].id;
    }

    // 2. Admin User
    const adminHash = await bcrypt.hash('admin123', 10);
    const [adminRes] = await connection.query(
      `INSERT INTO users (username, password_hash, role, full_name, is_active)
       VALUES ('admin', ?, 'admin', 'Dr. Sarah Connor (Admin)', 1)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [adminHash]
    );
    const adminId = adminRes.insertId;

    // 3. Demo Students
    const studentHash = await bcrypt.hash('student123', 10);
    const sampleStudents = [
      { username: 'alex', roll_no: '2026-CS-01', full_name: 'Alex Rivera', dept: 'Computer Science' },
      { username: 'beatrice', roll_no: '2026-CS-02', full_name: 'Beatrice Vance', dept: 'Computer Science' },
      { username: 'charlie', roll_no: '2026-CS-03', full_name: 'Charlie Chen', dept: 'Information Technology' },
      { username: 'diana', roll_no: '2026-CS-04', full_name: 'Diana Prince', dept: 'Computer Science' },
      { username: 'ethan', roll_no: '2026-CS-05', full_name: 'Ethan Hunt', dept: 'Cyber Security' }
    ];

    const studentIds = [];
    for (const s of sampleStudents) {
      const [res] = await connection.query(
        `INSERT INTO users (username, password_hash, role, full_name, roll_no, department, is_active)
         VALUES (?, ?, 'student', ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [s.username, studentHash, s.full_name, s.roll_no, s.dept]
      );
      studentIds.push(res.insertId);

      // Enroll in Semester 1
      await connection.query(
        `INSERT IGNORE INTO enrollments (student_id, semester_id) VALUES (?, ?)`,
        [res.insertId, semId]
      );
    }

    // 4. Sample Subjects
    const sampleSubjects = [
      'Data Structures & Algorithms',
      'Operating Systems',
      'Database Management Systems',
      'Computer Networks'
    ];

    const subjectIds = [];
    for (const subName of sampleSubjects) {
      const [res] = await connection.query(
        `INSERT INTO subjects (semester_id, subject_name, assigned_admin_id)
         VALUES (?, ?, ?)`,
        [semId, subName, adminId]
      );
      subjectIds.push(res.insertId);
    }

    // 5. Sample Attendance Records for 10 dates
    const dates = [
      '2026-07-01', '2026-07-02', '2026-07-05', '2026-07-06', '2026-07-08',
      '2026-07-09', '2026-07-12', '2026-07-15', '2026-07-18', '2026-07-20'
    ];

    const absenceReasons = ['normal_absent', 'fest', 'college_duty', 'medical', 'od_duty', 'other'];

    for (const subId of subjectIds) {
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        for (let j = 0; j < studentIds.length; j++) {
          const stId = studentIds[j];
          // Give Ethan lower attendance (<75%), Alex higher attendance
          let status = 'present';
          let reason = null;
          let note = null;

          if (stId === studentIds[4] && i > 3) {
            // Ethan absent frequently
            status = 'absent';
            reason = absenceReasons[i % absenceReasons.length];
            note = `Excused note for ${reason}`;
          } else if (i % 4 === 0 && j % 2 === 1) {
            status = 'absent';
            reason = absenceReasons[(i + j) % absenceReasons.length];
            note = `Participation in college event`;
          }

          await connection.query(
            `INSERT INTO attendance (student_id, subject_id, semester_id, date, status, absence_reason, reason_note, marked_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status=VALUES(status), absence_reason=VALUES(absence_reason)`,
            [stId, subId, semId, d, status, reason, note, adminId]
          );
        }
      }
    }

    console.log('✅ Demo data seeded successfully!');
    console.log('  Admins: admin / admin123');
    console.log('  Students: alex / student123, beatrice / student123, ethan / student123');
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

seedDemoData();
