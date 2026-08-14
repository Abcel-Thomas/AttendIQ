const bcrypt = require('bcryptjs');
const { getPool } = require('./db');

async function cleanDatabase() {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    console.log('🧹 Purging sample students and attendance data for a clean production state...');
    await connection.query(`SET FOREIGN_KEY_CHECKS = 0;`);
    await connection.query(`TRUNCATE TABLE attendance;`);
    await connection.query(`TRUNCATE TABLE enrollments;`);
    await connection.query(`TRUNCATE TABLE audit_log;`);
    await connection.query(`DELETE FROM users WHERE role = 'student';`);
    await connection.query(`SET FOREIGN_KEY_CHECKS = 1;`);

    // Ensure default admin exists
    const [adminRows] = await connection.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (adminRows.length === 0) {
      const defaultHash = await bcrypt.hash('admin123', 10);
      await connection.query(
        `INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES (?, ?, 'admin', 'System Administrator', 1)`,
        ['admin', defaultHash]
      );
      console.log('✅ Default Admin created (username: admin, password: admin123)');
    }

    // Ensure default Semester 1 exists
    const [semRows] = await connection.query(`SELECT id FROM semesters LIMIT 1`);
    if (semRows.length === 0) {
      await connection.query(
        `INSERT INTO semesters (semester_number, start_date, end_date, is_active) VALUES (1, '2026-01-01', '2026-06-30', 1)`
      );
      console.log('✅ Default Semester 1 created and activated.');
    }

    console.log('✨ Database is clean! System ready for Admin user creation.');
    console.log('  Default Admin Login: username: admin / password: admin123');
  } catch (err) {
    console.error('Clean DB error:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

cleanDatabase();
