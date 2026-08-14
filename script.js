const API_BASE = 'http://localhost:5000/api';

// Application State
let token = localStorage.getItem('attendiq_token') || null;
let currentUser = JSON.parse(localStorage.getItem('attendiq_user') || 'null');
let activeSemesterId = null;
let absenceReasonChart = null;

// Reason Color & Label Map
const REASON_MAP = {
  normal_absent: { label: 'Normal Absent', color: '#ef4444', class: 'chip-normal_absent' },
  fest: { label: 'Fest Leave', color: '#a855f7', class: 'chip-fest' },
  college_duty: { label: 'College Duty', color: '#3b82f6', class: 'chip-college_duty' },
  medical: { label: 'Medical Leave', color: '#f59e0b', class: 'chip-medical' },
  od_duty: { label: 'OD / Duty Leave', color: '#06b6d4', class: 'chip-od_duty' },
  other: { label: 'Other Reason', color: '#64748b', class: 'chip-other' }
};

// ----------------- DOM INITIALIZATION -----------------
document.addEventListener('DOMContentLoaded', () => {
  setupCursorSpotlight();
  setup3DTilt();
  setupEventListeners();

  if (token && currentUser) {
    initAuthenticatedSession();
  } else {
    showLoginView();
  }
});

// ----------------- AUTHENTICATION -----------------
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value;
  const errorBox = document.getElementById('login-error');

  errorBox.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });

    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Login failed.';
      errorBox.classList.remove('hidden');
      return;
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('attendiq_token', token);
    localStorage.setItem('attendiq_user', JSON.stringify(currentUser));

    showToast(`Welcome back, ${currentUser.full_name}!`, 'success');
    initAuthenticatedSession();
  } catch (err) {
    errorBox.textContent = 'Server connection error. Please try again.';
    errorBox.classList.remove('hidden');
  }
}

function handleLogout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('attendiq_token');
  localStorage.removeItem('attendiq_user');
  showLoginView();
  showToast('Logged out successfully.', 'info');
}

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
}

async function initAuthenticatedSession() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');

  // Populate User Profile Badge
  document.getElementById('user-display-name').textContent = currentUser.full_name;
  document.getElementById('user-role-chip').textContent = currentUser.role.toUpperCase();
  document.getElementById('user-avatar-initials').textContent = currentUser.full_name.charAt(0).toUpperCase();

  // Load Semesters
  await loadGlobalSemesters();

  // Build Dynamic Nav Links based on Role
  renderNavigation();
}

// ----------------- SEMESTER MANAGEMENT -----------------
async function loadGlobalSemesters() {
  const select = document.getElementById('global-semester-select');
  select.innerHTML = '';

  try {
    const res = await fetch(`${API_BASE}/admin/semesters`, { headers: authHeaders() });
    if (!res.ok) return;

    const semesters = await res.json();
    if (semesters.length === 0) {
      select.innerHTML = `<option value="">No Semesters Found</option>`;
      return;
    }

    let activeSem = semesters.find(s => s.is_active) || semesters[0];
    activeSemesterId = activeSem.id;

    semesters.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `Semester ${s.semester_number} ${s.is_active ? '(Active)' : ''}`;
      if (s.id === activeSemesterId) opt.selected = true;
      select.appendChild(opt);
    });

    select.onchange = (e) => {
      activeSemesterId = parseInt(e.target.value);
      refreshActiveSectionData();
    };
  } catch (err) {
    console.error('Failed to load semesters:', err);
  }
}

// ----------------- DYNAMIC NAVIGATION -----------------
function renderNavigation() {
  const navList = document.getElementById('nav-links');
  navList.innerHTML = '';

  let items = [];

  if (currentUser.role === 'admin') {
    items = [
      { id: 'admin-overview-section', label: 'College Overview', icon: '📊' },
      { id: 'admin-mark-section', label: 'Mark Attendance', icon: '✏️' },
      { id: 'admin-reports-section', label: 'Student Reports', icon: '📈' },
      { id: 'admin-users-section', label: 'User Management', icon: '👥' },
      { id: 'admin-academic-section', label: 'Semesters & Subjects', icon: '📚' },
      { id: 'admin-audit-section', label: 'Audit Trail', icon: '📜' }
    ];
  } else {
    items = [
      { id: 'student-dashboard-section', label: 'Student Dashboard', icon: '🎓' }
    ];
  }

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    if (idx === 0) li.classList.add('active');
    li.dataset.target = item.id;
    li.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;
    li.onclick = () => switchSection(item.id, li);
    navList.appendChild(li);
  });

  // Load first section
  switchSection(items[0].id, navList.children[0]);
}

function switchSection(sectionId, navLi) {
  document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
  if (navLi) navLi.classList.add('active');

  document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active-section', 'hidden'));
  document.querySelectorAll('.content-section').forEach(sec => {
    if (sec.id === sectionId) {
      sec.classList.add('active-section');
    } else {
      sec.classList.add('hidden');
    }
  });

  refreshActiveSectionData(sectionId);
}

function refreshActiveSectionData(currentSecId) {
  const activeSec = currentSecId || document.querySelector('.content-section:not(.hidden)')?.id;
  if (!activeSec || !activeSemesterId) return;

  switch (activeSec) {
    case 'admin-overview-section':
      loadAdminOverview();
      break;
    case 'admin-mark-section':
      loadMarkAttendanceSubjectList();
      break;
    case 'admin-reports-section':
      loadReportsStudentList();
      break;
    case 'admin-users-section':
      loadAdminUsers();
      break;
    case 'admin-academic-section':
      loadAcademicManager();
      break;
    case 'admin-audit-section':
      loadAuditLog();
      break;
    case 'student-dashboard-section':
      loadStudentDashboard();
      break;
  }
}

// ----------------- ADMIN: OVERVIEW -----------------
async function loadAdminOverview() {
  try {
    const res = await fetch(`${API_BASE}/admin/overview?semester_id=${activeSemesterId}`, { headers: authHeaders() });
    if (!res.ok) return;

    const data = await res.json();

    // Counters
    animateCounter(document.getElementById('stat-enrolled'), data.enrolled_students);
    animateCounter(document.getElementById('stat-avg-pct'), data.average_percentage);
    animateCounter(document.getElementById('stat-risk-count'), data.low_attendance_count);
    animateCounter(document.getElementById('stat-total-records'), data.total_records);

    // Chart
    renderAbsenceReasonChart(data.absence_reasons);

    // Table
    const tbody = document.getElementById('at-risk-table-body');
    tbody.innerHTML = '';

    if (data.low_attendance_students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-success">🎉 No students currently below 75% shortage threshold!</td></tr>`;
      return;
    }

    data.low_attendance_students.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${s.full_name}</strong></td>
        <td><code>${s.roll_no || 'N/A'}</code></td>
        <td><span class="badge badge-danger">${s.percentage}%</span></td>
        <td><span class="text-warning">Must attend next <strong>${s.classes_needed}</strong> classes</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

function renderAbsenceReasonChart(reasons) {
  const ctx = document.getElementById('absenceReasonChart').getContext('2d');
  if (absenceReasonChart) absenceReasonChart.destroy();

  const labels = [];
  const counts = [];
  const bgColors = [];

  reasons.forEach(r => {
    const meta = REASON_MAP[r.absence_reason] || REASON_MAP.normal_absent;
    labels.push(meta.label);
    counts.push(r.count);
    bgColors.push(meta.color);
  });

  if (labels.length === 0) {
    labels.push('No Absences');
    counts.push(1);
    bgColors.push('#10b981');
  }

  absenceReasonChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: bgColors,
        borderWidth: 2,
        borderColor: '#161f31'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8' } }
      }
    }
  });
}

// ----------------- ADMIN: MARK ATTENDANCE -----------------
async function loadMarkAttendanceSubjectList() {
  const select = document.getElementById('mark-subject-select');
  select.innerHTML = '<option value="">Select a subject...</option>';

  const dateInput = document.getElementById('mark-date-input');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  try {
    const res = await fetch(`${API_BASE}/admin/subjects?semester_id=${activeSemesterId}`, { headers: authHeaders() });
    if (!res.ok) return;

    const subjects = await res.json();
    subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.subject_name;
      select.appendChild(opt);
    });

    select.onchange = () => loadRosterForAttendance(select.value);
  } catch (err) {
    console.error('Failed to load subjects:', err);
  }
}

async function loadRosterForAttendance(subjectId) {
  const tbody = document.getElementById('mark-roster-body');
  const countBadge = document.getElementById('roster-count-badge');

  if (!subjectId) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Select a subject to load students.</td></tr>`;
    countBadge.textContent = `0 Students`;
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/students?semester_id=${activeSemesterId}`, { headers: authHeaders() });
    if (!res.ok) return;

    const students = await res.json();
    countBadge.textContent = `${students.length} Students`;
    tbody.innerHTML = '';

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">No students enrolled in this semester.</td></tr>`;
      return;
    }

    students.forEach(s => {
      const tr = document.createElement('tr');
      tr.dataset.studentId = s.id;
      tr.innerHTML = `
        <td><code>${s.roll_no || 'N/A'}</code></td>
        <td><strong>${s.full_name}</strong></td>
        <td>${s.department || 'N/A'}</td>
        <td>
          <div class="status-toggle-wrapper">
            <label>
              <input type="radio" name="status-${s.id}" value="present" checked onchange="handleRosterStatusToggle(${s.id}, 'present')">
              <span>Present</span>
            </label>
            <label>
              <input type="radio" name="status-${s.id}" value="absent" onchange="handleRosterStatusToggle(${s.id}, 'absent')">
              <span>Absent</span>
            </label>
          </div>
        </td>
        <td>
          <select id="reason-${s.id}" class="form-control select-sm hidden">
            <option value="normal_absent">Normal Absent</option>
            <option value="fest">Fest Leave</option>
            <option value="college_duty">College Duty</option>
            <option value="medical">Medical Leave</option>
            <option value="od_duty">OD / Duty Leave</option>
            <option value="other">Other</option>
          </select>
        </td>
        <td>
          <input type="text" id="note-${s.id}" placeholder="Reason note..." class="form-control select-sm hidden">
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load roster:', err);
  }
}

function handleRosterStatusToggle(studentId, status) {
  const reasonSelect = document.getElementById(`reason-${studentId}`);
  const noteInput = document.getElementById(`note-${studentId}`);

  if (status === 'absent') {
    reasonSelect.classList.remove('hidden');
    noteInput.classList.remove('hidden');
  } else {
    reasonSelect.classList.add('hidden');
    noteInput.classList.add('hidden');
  }
}

function markAllPresent() {
  const radioButtons = document.querySelectorAll('input[type="radio"][value="present"]');
  radioButtons.forEach(rb => {
    rb.checked = true;
    const studentId = rb.name.replace('status-', '');
    handleRosterStatusToggle(studentId, 'present');
  });
  showToast('All students marked as Present.', 'info');
}

async function submitAttendanceRecords() {
  const subjectId = document.getElementById('mark-subject-select').value;
  const dateVal = document.getElementById('mark-date-input').value;

  if (!subjectId || !dateVal) {
    showToast('Please select both a subject and an attendance date.', 'warning');
    return;
  }

  const rows = document.querySelectorAll('#mark-roster-body tr');
  const records = [];

  rows.forEach(tr => {
    const studentId = tr.dataset.studentId;
    if (!studentId) return;

    const statusRadio = tr.querySelector(`input[name="status-${studentId}"]:checked`);
    const status = statusRadio ? statusRadio.value : 'present';
    const reasonSelect = document.getElementById(`reason-${studentId}`);
    const noteInput = document.getElementById(`note-${studentId}`);

    records.push({
      student_id: parseInt(studentId),
      status,
      absence_reason: status === 'absent' ? reasonSelect.value : null,
      reason_note: status === 'absent' ? noteInput.value.trim() : null
    });
  });

  if (records.length === 0) {
    showToast('No student records to submit.', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/attendance`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        semester_id: activeSemesterId,
        subject_id: parseInt(subjectId),
        date: dateVal,
        records
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to save attendance.', 'danger');
      return;
    }

    showToast('Attendance saved successfully in a single transaction!', 'success');
  } catch (err) {
    showToast('Connection error while saving attendance.', 'danger');
  }
}

// ----------------- ADMIN: REPORTS & CSV EXPORT -----------------
let currentStudentReportData = null;

async function loadReportsStudentList() {
  const select = document.getElementById('report-student-select');
  select.innerHTML = '<option value="">Select a student...</option>';

  try {
    const res = await fetch(`${API_BASE}/admin/students?semester_id=${activeSemesterId}`, { headers: authHeaders() });
    if (!res.ok) return;

    const students = await res.json();
    students.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.full_name} (${s.roll_no || s.username})`;
      select.appendChild(opt);
    });

    select.onchange = () => fetchAndRenderStudentReport(select.value);
  } catch (err) {
    console.error('Failed to load report students:', err);
  }
}

async function fetchAndRenderStudentReport(studentId) {
  const detailsDiv = document.getElementById('student-report-details');
  if (!studentId) {
    detailsDiv.classList.add('hidden');
    currentStudentReportData = null;
    return;
  }

  try {
    const [repRes, absRes] = await Promise.all([
      fetch(`${API_BASE}/admin/report/${studentId}?semester_id=${activeSemesterId}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/admin/report/${studentId}/absences?semester_id=${activeSemesterId}`, { headers: authHeaders() })
    ]);

    if (!repRes.ok) return;

    const repData = await repRes.json();
    const absData = absRes.ok ? await absRes.json() : [];

    currentStudentReportData = { ...repData, absences: absData };
    detailsDiv.classList.remove('hidden');

    // Metrics
    animateCounter(document.getElementById('rep-total-classes'), repData.overall.total_classes);
    animateCounter(document.getElementById('rep-attended'), repData.overall.attended_classes);
    animateCounter(document.getElementById('rep-absent'), repData.overall.absent_classes);
    animateCounter(document.getElementById('rep-percentage'), repData.overall.percentage);

    // Subject Breakdown
    const tbody = document.getElementById('rep-subjects-body');
    tbody.innerHTML = '';

    repData.subjects.forEach(s => {
      const tr = document.createElement('tr');
      const pctBadge = s.percentage >= 75 ? 'badge-success' : 'badge-danger';
      tr.innerHTML = `
        <td><strong>${s.subject_name}</strong></td>
        <td>${s.total_classes}</td>
        <td>${s.attended_classes}</td>
        <td>${s.absent_classes}</td>
        <td><span class="badge ${pctBadge}">${s.percentage}%</span></td>
      `;
      tbody.appendChild(tr);
    });

    // Absence Chips
    const chipContainer = document.getElementById('rep-absence-chips-list');
    const chipCountBadge = document.getElementById('rep-absence-count-chip');
    chipContainer.innerHTML = '';
    chipCountBadge.textContent = `${absData.length} Absences`;

    if (absData.length === 0) {
      chipContainer.innerHTML = `<p class="text-muted">No absence records found for this semester!</p>`;
      return;
    }

    absData.forEach(a => {
      const meta = REASON_MAP[a.absence_reason] || REASON_MAP.normal_absent;
      const card = document.createElement('div');
      card.className = `absence-chip-card ${meta.class}`;
      card.innerHTML = `
        <div class="chip-info">
          <span class="chip-reason-name">${meta.label}</span>
          <span class="chip-meta">${a.subject_name} ${a.reason_note ? `• "${a.reason_note}"` : ''}</span>
        </div>
        <span class="chip-date">${a.date.split('T')[0]}</span>
      `;
      chipContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to fetch student report:', err);
  }
}

function exportReportToCSV() {
  if (!currentStudentReportData) {
    showToast('Please select a student to generate a report first.', 'warning');
    return;
  }

  const { student, overall, subjects, absences } = currentStudentReportData;
  let csv = `AttendIQ Attendance Report\n`;
  csv += `Student Name,${student.full_name}\n`;
  csv += `Roll Number,${student.roll_no || 'N/A'}\n`;
  csv += `Department,${student.department || 'N/A'}\n`;
  csv += `Overall Attendance %,${overall.percentage}%\n\n`;

  csv += `Subject,Total Classes,Attended,Absent,Percentage\n`;
  subjects.forEach(s => {
    csv += `"${s.subject_name}",${s.total_classes},${s.attended_classes},${s.absent_classes},${s.percentage}%\n`;
  });

  csv += `\nAbsence History\nDate,Subject,Reason,Note\n`;
  absences.forEach(a => {
    const meta = REASON_MAP[a.absence_reason] || REASON_MAP.normal_absent;
    csv += `${a.date.split('T')[0]},"${a.subject_name}","${meta.label}","${a.reason_note || ''}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `Attendance_Report_${student.roll_no || student.username}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Report exported to CSV file successfully.', 'success');
}

// ----------------- ADMIN: USER MANAGEMENT -----------------
async function loadAdminUsers() {
  const tbody = document.getElementById('users-table-body');
  try {
    const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
    if (!res.ok) return;

    const users = await res.json();
    tbody.innerHTML = '';

    users.forEach(u => {
      const tr = document.createElement('tr');
      const statusBadge = u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Deactivated</span>';
      const roleBadge = u.role === 'admin' ? '<span class="badge badge-warning">Admin</span>' : '<span class="badge">Student</span>';

      tr.innerHTML = `
        <td><code>${u.username}</code></td>
        <td><strong>${u.full_name}</strong></td>
        <td>${roleBadge}</td>
        <td>${u.roll_no || 'N/A'}</td>
        <td>${u.department || 'N/A'}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editUserAccount(${u.id})">Edit</button>
          <button class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-success'}" onclick="toggleUserActiveStatus(${u.id}, ${u.is_active})">
            ${u.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

async function toggleUserActiveStatus(userId, currentStatus) {
  try {
    const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ is_active: currentStatus ? 0 : 1 })
    });
    if (res.ok) {
      showToast('User status updated.', 'success');
      loadAdminUsers();
    }
  } catch (err) {
    showToast('Failed to update user status.', 'danger');
  }
}

// ----------------- ADMIN: ACADEMIC MANAGER -----------------
async function loadAcademicManager() {
  await Promise.all([loadSemestersTable(), loadSubjectsTable(), loadEnrollmentManager()]);
}

async function loadSemestersTable() {
  const tbody = document.getElementById('semesters-table-body');
  try {
    const res = await fetch(`${API_BASE}/admin/semesters`, { headers: authHeaders() });
    if (!res.ok) return;

    const semesters = await res.json();
    tbody.innerHTML = '';

    semesters.forEach(s => {
      const tr = document.createElement('tr');
      const statusBadge = s.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge">Inactive</span>';
      tr.innerHTML = `
        <td>Semester ${s.semester_number}</td>
        <td>${s.start_date.split('T')[0]}</td>
        <td>${s.end_date.split('T')[0]}</td>
        <td>${statusBadge}</td>
        <td>
          ${!s.is_active ? `<button class="btn btn-sm btn-primary" onclick="setSemesterActive(${s.id})">Activate</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load semesters:', err);
  }
}

async function setSemesterActive(semId) {
  try {
    const res = await fetch(`${API_BASE}/admin/semesters/${semId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ is_active: 1 })
    });
    if (res.ok) {
      showToast('Active semester updated.', 'success');
      loadGlobalSemesters();
      loadSemestersTable();
    }
  } catch (err) {
    showToast('Failed to set active semester.', 'danger');
  }
}

async function loadSubjectsTable() {
  const tbody = document.getElementById('subjects-table-body');
  try {
    const res = await fetch(`${API_BASE}/admin/subjects?semester_id=${activeSemesterId}`, { headers: authHeaders() });
    if (!res.ok) return;

    const subjects = await res.json();
    tbody.innerHTML = '';

    if (subjects.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center">No subjects created for this semester.</td></tr>`;
      return;
    }

    subjects.forEach(sub => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${sub.subject_name}</strong></td>
        <td>${sub.assigned_admin_name || 'Unassigned'}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="editSubject(${sub.id}, '${sub.subject_name}')">Edit</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load subjects table:', err);
  }
}

async function loadEnrollmentManager() {
  const semSelect = document.getElementById('enrollment-semester-select');
  const unenrolledDiv = document.getElementById('unenrolled-students-list');
  const enrolledDiv = document.getElementById('enrolled-students-list');

  try {
    const [allStudRes, enrStudRes, semRes] = await Promise.all([
      fetch(`${API_BASE}/admin/students`, { headers: authHeaders() }),
      fetch(`${API_BASE}/admin/students?semester_id=${activeSemesterId}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/admin/semesters`, { headers: authHeaders() })
    ]);

    const allStudents = await allStudRes.json();
    const enrolledStudents = await enrStudRes.json();
    const semesters = await semRes.json();

    semSelect.innerHTML = '';
    semesters.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `Semester ${s.semester_number}`;
      if (s.id === activeSemesterId) opt.selected = true;
      semSelect.appendChild(opt);
    });

    const enrolledIds = new Set(enrolledStudents.map(s => s.id));

    unenrolledDiv.innerHTML = '';
    enrolledDiv.innerHTML = '';

    allStudents.forEach(s => {
      const isEnrolled = enrolledIds.has(s.id);
      const item = document.createElement('label');
      item.className = 'checklist-item';
      item.innerHTML = `<input type="checkbox" value="${s.id}"> <span>${s.full_name} (${s.roll_no || s.username})</span>`;

      if (isEnrolled) {
        enrolledDiv.appendChild(item);
      } else {
        unenrolledDiv.appendChild(item);
      }
    });
  } catch (err) {
    console.error('Failed to load enrollment manager:', err);
  }
}

// ----------------- ADMIN: AUDIT LOG -----------------
async function loadAuditLog() {
  const tbody = document.getElementById('audit-table-body');
  try {
    const res = await fetch(`${API_BASE}/admin/audit-log`, { headers: authHeaders() });
    if (!res.ok) return;

    const logs = await res.json();
    tbody.innerHTML = '';

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center">No audit records logged yet.</td></tr>`;
      return;
    }

    logs.forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${new Date(l.created_at).toLocaleString()}</code></td>
        <td><strong>${l.admin_name || l.admin_username}</strong></td>
        <td><span class="badge badge-warning">${l.action_type}</span></td>
        <td><code>${l.target_table}</code></td>
        <td><small>${l.details || 'N/A'}</small></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load audit logs:', err);
  }
}

// ----------------- STUDENT: DASHBOARD & 75% CALCULATOR -----------------
async function loadStudentDashboard() {
  try {
    const [repRes, projRes, absRes, subjRes] = await Promise.all([
      fetch(`${API_BASE}/student/report?semester_id=${activeSemesterId}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/student/projection?semester_id=${activeSemesterId}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/student/absences?semester_id=${activeSemesterId}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/student/subjects?semester_id=${activeSemesterId}`, { headers: authHeaders() })
    ]);

    if (!repRes.ok) return;

    const repData = await repRes.json();
    const projData = projRes.ok ? await projRes.json() : null;
    const absData = absRes.ok ? await absRes.json() : [];
    const enrolledSubjs = subjRes.ok ? await subjRes.json() : [];

    // Subtitle
    document.getElementById('student-welcome-subtitle').textContent = `Welcome ${repData.student.full_name} (${repData.student.roll_no || repData.student.department || ''})`;

    // My Enrolled Subjects Table (Admin-Assigned)
    const enrTbody = document.getElementById('student-enrolled-subjects-body');
    if (enrTbody) {
      enrTbody.innerHTML = '';
      if (enrolledSubjs.length === 0) {
        enrTbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">You are not currently enrolled in any subjects for this semester. Contact your Admin.</td></tr>`;
      } else {
        enrolledSubjs.forEach(s => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${s.subject_name}</strong></td>
            <td>${s.assigned_admin_name || 'System Admin'}</td>
          `;
          enrTbody.appendChild(tr);
        });
      }
    }

    // Metrics
    animateCounter(document.getElementById('stu-stat-held'), repData.overall.total_classes);
    animateCounter(document.getElementById('stu-stat-attended'), repData.overall.attended_classes);
    animateCounter(document.getElementById('stu-stat-absent'), repData.overall.absent_classes);
    animateCounter(document.getElementById('student-gauge-pct'), repData.overall.percentage);

    // Gauge Ring Fill
    updateGaugeRing(repData.overall.percentage);

    // 75% Calculator Box
    renderStudentCalculatorBox(projData);

    // Subjects Grid
    const subjGrid = document.getElementById('student-subjects-grid');
    subjGrid.innerHTML = '';

    if (repData.subjects.length === 0) {
      subjGrid.innerHTML = `<p class="text-muted">No subjects registered for this semester.</p>`;
    } else {
      repData.subjects.forEach(sub => {
        const card = document.createElement('div');
        card.className = 'card glass-card tilt-card';
        card.dataset.tilt = '';
        const pctClass = sub.percentage >= 75 ? 'text-success' : 'text-danger';
        card.innerHTML = `
          <h4>${sub.subject_name}</h4>
          <div style="font-size: 24px; font-weight: 800; margin: 10px 0;" class="${pctClass}">${sub.percentage}%</div>
          <p class="text-muted">Attended ${sub.attended_classes} of ${sub.total_classes} classes</p>
        `;
        subjGrid.appendChild(card);
      });
      setup3DTilt();
    }

    // Absence History Chips
    const absContainer = document.getElementById('student-absence-history-list');
    absContainer.innerHTML = '';

    if (absData.length === 0) {
      absContainer.innerHTML = `<p class="text-success">🎉 Excellent! Zero absences recorded in this semester.</p>`;
    } else {
      absData.forEach(a => {
        const meta = REASON_MAP[a.absence_reason] || REASON_MAP.normal_absent;
        const card = document.createElement('div');
        card.className = `absence-chip-card ${meta.class}`;
        card.innerHTML = `
          <div class="chip-info">
            <span class="chip-reason-name">${meta.label}</span>
            <span class="chip-meta">${a.subject_name} ${a.reason_note ? `• "${a.reason_note}"` : ''}</span>
          </div>
          <span class="chip-date">${a.date.split('T')[0]}</span>
        `;
        absContainer.appendChild(card);
      });
    }
  } catch (err) {
    console.error('Failed to load student dashboard:', err);
  }
}

function updateGaugeRing(percentage) {
  const ring = document.getElementById('student-gauge-ring');
  if (!ring) return;

  const circumference = 2 * Math.PI * 68; // r=68 => ~427.25
  const offset = circumference - (percentage / 100) * circumference;

  ring.style.strokeDashoffset = offset;

  if (percentage >= 75) {
    ring.style.stroke = 'var(--success-color)';
  } else if (percentage >= 65) {
    ring.style.stroke = 'var(--warning-color)';
  } else {
    ring.style.stroke = 'var(--danger-color)';
  }
}

function renderStudentCalculatorBox(proj) {
  const box = document.getElementById('calculator-status-box');
  if (!proj) return;

  if (proj.total_classes === 0) {
    box.innerHTML = `
      <div class="calc-banner calc-banner-success">
        <span>ℹ️ No attendance records posted yet for this semester.</span>
      </div>
    `;
    return;
  }

  if (proj.current_percentage < 75) {
    box.innerHTML = `
      <div class="calc-banner calc-banner-warning">
        <span>⚠️ Attendance Shortage Warning (${proj.current_percentage}%)</span>
      </div>
      <p class="calc-message">
        You must attend the next <strong class="text-danger">${proj.classes_needed} consecutive classes</strong> without missing any to reach the mandatory <strong>75% threshold</strong>.
      </p>
    `;
  } else {
    box.innerHTML = `
      <div class="calc-banner calc-banner-success">
        <span>✅ Attendance Target Met (${proj.current_percentage}%)</span>
      </div>
      <p class="calc-message">
        You can afford to miss up to <strong class="text-success">${proj.classes_bunkable} more classes</strong> and still remain above the <strong>75% requirement</strong>.
      </p>
    `;
  }
}

// ----------------- UI ANIMATIONS & EFFECTS -----------------

// Spotlight Cursor Tracking
function setupCursorSpotlight() {
  document.addEventListener('mousemove', (e) => {
    document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
  });
}

// 3D Tilt-on-hover logic
function setup3DTilt() {
  const cards = document.querySelectorAll('[data-tilt]');
  cards.forEach(card => {
    card.onmousemove = (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -8;
      const rotateY = ((x - centerX) / centerX) * 8;

      card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    };

    card.onmouseleave = () => {
      card.style.transform = `perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
    };
  });
}

// Count-up counter animation
function animateCounter(el, target, duration = 800) {
  if (!el) return;
  const start = 0;
  const targetNum = parseFloat(target) || 0;
  const isDecimal = targetNum % 1 !== 0;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const val = start + (targetNum - start) * easeProgress;

    el.textContent = isDecimal ? val.toFixed(1) : Math.round(val);

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = targetNum;
    }
  }

  requestAnimationFrame(update);
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// ----------------- MODAL & EVENT LISTENERS -----------------
function setupEventListeners() {
  document.getElementById('login-form').onsubmit = handleLogin;
  document.getElementById('btn-logout').onclick = handleLogout;
  document.getElementById('btn-mark-all-present').onclick = markAllPresent;
  document.getElementById('btn-submit-attendance').onclick = submitAttendanceRecords;
  document.getElementById('btn-export-csv').onclick = exportReportToCSV;

  // Dark Mode Toggle
  const themeToggle = document.getElementById('dark-mode-toggle');
  themeToggle.onchange = (e) => {
    if (e.target.checked) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  };

  // Modal Close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });

  // User Management Modals
  document.getElementById('btn-open-create-user').onclick = () => openUserModal();
  document.getElementById('user-form').onsubmit = submitUserForm;

  document.getElementById('btn-open-bulk-import').onclick = () => openBulkImportModal();
  document.getElementById('bulk-import-form').onsubmit = submitBulkImportForm;

  // Academic Modals
  document.getElementById('btn-open-create-semester').onclick = () => openSemesterModal();
  document.getElementById('semester-form').onsubmit = submitSemesterForm;

  document.getElementById('btn-open-create-subject').onclick = () => openSubjectModal();
  document.getElementById('subject-form').onsubmit = submitSubjectForm;

  // Enrollment Buttons
  document.getElementById('btn-enroll-selected').onclick = () => submitEnrollmentChange('enroll');
  document.getElementById('btn-unenroll-selected').onclick = () => submitEnrollmentChange('unenroll');
}

function openModal(modalId) {
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById(modalId).classList.remove('hidden');
}

function closeModal(modalId) {
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.getElementById(modalId).classList.add('hidden');
}

// User Modal
function openUserModal(userId = null) {
  document.getElementById('user-modal-id').value = userId || '';
  document.getElementById('user-modal-title').textContent = userId ? 'Edit User Account' : 'Create User Account';
  if (!userId) {
    document.getElementById('user-form').reset();
  }
  openModal('user-modal');
}

async function submitUserForm(e) {
  e.preventDefault();
  const userId = document.getElementById('user-modal-id').value;
  const payload = {
    role: document.getElementById('user-modal-role').value,
    username: document.getElementById('user-modal-username').value.trim(),
    full_name: document.getElementById('user-modal-fullname').value.trim(),
    password: document.getElementById('user-modal-password').value,
    roll_no: document.getElementById('user-modal-roll').value.trim() || null,
    department: document.getElementById('user-modal-dept').value.trim() || null,
    semester_id: activeSemesterId
  };

  try {
    const url = userId ? `${API_BASE}/admin/users/${userId}` : `${API_BASE}/admin/users`;
    const method = userId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to save user.', 'danger');
      return;
    }

    showToast('User account saved successfully.', 'success');
    closeModal('user-modal');
    loadAdminUsers();
  } catch (err) {
    showToast('Connection error while saving user.', 'danger');
  }
}

// Bulk Import Modal
function openBulkImportModal() {
  const semSelect = document.getElementById('csv-semester-select');
  semSelect.innerHTML = document.getElementById('global-semester-select').innerHTML;
  openModal('bulk-import-modal');
}

async function submitBulkImportForm(e) {
  e.preventDefault();
  const fileInput = document.getElementById('csv-file-input');
  const semesterId = document.getElementById('csv-semester-select').value;

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a CSV file to upload.', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('csv_file', fileInput.files[0]);
  formData.append('semester_id', semesterId);

  try {
    const res = await fetch(`${API_BASE}/admin/users/bulk-import`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Bulk import failed.', 'danger');
      return;
    }

    showToast(data.message, 'success');
    closeModal('bulk-import-modal');
    loadAdminUsers();
  } catch (err) {
    showToast('Failed to process bulk import.', 'danger');
  }
}

// Semester Modal
function openSemesterModal() {
  document.getElementById('semester-form').reset();
  openModal('semester-modal');
}

async function submitSemesterForm(e) {
  e.preventDefault();
  const payload = {
    semester_number: parseInt(document.getElementById('sem-number-input').value),
    start_date: document.getElementById('sem-start-input').value,
    end_date: document.getElementById('sem-end-input').value,
    is_active: document.getElementById('sem-active-checkbox').checked ? 1 : 0
  };

  try {
    const res = await fetch(`${API_BASE}/admin/semesters`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('Semester created successfully.', 'success');
      closeModal('semester-modal');
      loadGlobalSemesters();
      loadSemestersTable();
    }
  } catch (err) {
    showToast('Failed to create semester.', 'danger');
  }
}

// Subject Modal
async function openSubjectModal() {
  const adminSelect = document.getElementById('sub-admin-select');
  adminSelect.innerHTML = '';
  try {
    const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
    const users = await res.json();
    const admins = users.filter(u => u.role === 'admin');
    admins.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.full_name;
      adminSelect.appendChild(opt);
    });
  } catch (e) {}

  document.getElementById('subject-form').reset();
  openModal('subject-modal');
}

async function submitSubjectForm(e) {
  e.preventDefault();
  const payload = {
    semester_id: activeSemesterId,
    subject_name: document.getElementById('sub-name-input').value.trim(),
    assigned_admin_id: document.getElementById('sub-admin-select').value || null
  };

  try {
    const res = await fetch(`${API_BASE}/admin/subjects`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('Subject created successfully.', 'success');
      closeModal('subject-modal');
      loadSubjectsTable();
    }
  } catch (err) {
    showToast('Failed to create subject.', 'danger');
  }
}

// Enrollment Changes
async function submitEnrollmentChange(action) {
  const containerId = action === 'enroll' ? 'unenrolled-students-list' : 'enrolled-students-list';
  const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`);
  const studentIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

  if (studentIds.length === 0) {
    showToast(`Please select students to ${action}.`, 'warning');
    return;
  }

  const semesterId = document.getElementById('enrollment-semester-select').value;

  try {
    const res = await fetch(`${API_BASE}/admin/enrollments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ student_ids: studentIds, semester_id: parseInt(semesterId), action })
    });

    if (res.ok) {
      showToast(`Students ${action}ed successfully.`, 'success');
      loadEnrollmentManager();
    }
  } catch (err) {
    showToast(`Failed to update enrollment.`, 'danger');
  }
}
