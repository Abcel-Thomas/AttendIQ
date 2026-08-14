require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'abcel5425@',
  port: parseInt(process.env.DB_PORT || '3306'),
  multipleStatements: true
};

let pool;

async function getPool() {
  if (!pool) {
    const tempConn = await mysql.createConnection(dbConfig);
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS attendiq;`);
    await tempConn.end();

    pool = mysql.createPool({
      ...dbConfig,
      database: process.env.DB_NAME || 'attendiq',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    await initDB();
  }
  return pool;
}

async function initDB() {
  const connection = await pool.getConnection();
  try {
    // Check if migration is needed for old schema tables
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'attendiq' AND TABLE_NAME = 'subjects' AND COLUMN_NAME = 'semester_id'`
    );

    if (cols.length === 0) {
      console.log('🔄 Migrating database tables to v2.0 role-based schema...');
      await connection.query(`SET FOREIGN_KEY_CHECKS = 0;`);
      await connection.query(`DROP TABLE IF EXISTS attendance;`);
      await connection.query(`DROP TABLE IF EXISTS subjects;`);
      await connection.query(`DROP TABLE IF EXISTS students;`);
      await connection.query(`DROP TABLE IF EXISTS enrollments;`);
      await connection.query(`DROP TABLE IF EXISTS users;`);
      await connection.query(`DROP TABLE IF EXISTS semesters;`);
      await connection.query(`DROP TABLE IF EXISTS audit_log;`);
      await connection.query(`SET FOREIGN_KEY_CHECKS = 1;`);
    }

    // Create v2.0 tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin', 'student') NOT NULL DEFAULT 'student',
        full_name VARCHAR(255) NOT NULL,
        roll_no VARCHAR(50) NULL,
        department VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active TINYINT(1) DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS semesters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        semester_number INT NOT NULL UNIQUE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_active TINYINT(1) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        semester_id INT NOT NULL,
        subject_name VARCHAR(255) NOT NULL,
        assigned_admin_id INT NULL,
        FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_admin_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        semester_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
        UNIQUE KEY unique_enrollment (student_id, semester_id)
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        subject_id INT NOT NULL,
        semester_id INT NOT NULL,
        date DATE NOT NULL,
        status ENUM('present', 'absent') NOT NULL,
        absence_reason ENUM('normal_absent', 'fest', 'college_duty', 'medical', 'od_duty', 'other') NULL,
        reason_note VARCHAR(255) NULL,
        marked_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
        FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
        FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_attendance_entry (student_id, subject_id, date)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        target_table VARCHAR(100) NOT NULL,
        target_id INT NULL,
        details TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Seed default Admin if no admin exists
    const [adminRows] = await connection.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (adminRows.length === 0) {
      const defaultHash = await bcrypt.hash('admin123', 10);
      await connection.query(
        `INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES (?, ?, 'admin', 'System Administrator', 1)`,
        ['admin', defaultHash]
      );
      console.log('✅ Default Admin created (username: admin, password: admin123)');
    }

    // Seed default Semester if none exists
    const [semRows] = await connection.query(`SELECT id FROM semesters LIMIT 1`);
    if (semRows.length === 0) {
      await connection.query(
        `INSERT INTO semesters (semester_number, start_date, end_date, is_active) VALUES (1, '2026-01-01', '2026-06-30', 1)`
      );
      console.log('✅ Default Semester 1 created and activated.');
    }

  } catch (err) {
    console.error('Error initializing database tables:', err.message);
  } finally {
    connection.release();
  }
}

module.exports = { getPool };
