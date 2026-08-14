from flask import Flask, request, jsonify
from flask_cors import CORS # type: ignore
from db_config import get_db_connection
from flask import Flask

app = Flask(__name__)   # ✅ DEFINE FIRST

@app.route("/")         # ✅ THEN use it
def home():
    return "Backend is running 🚀"
CORS(app)

# ----------------- STUDENTS -----------------

@app.route('/api/students', methods=['GET'])
def get_students():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM students ORDER BY id DESC")
        students = cursor.fetchall()
        return jsonify(students), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/students', methods=['POST'])
def add_student():
    data = request.json
    name = data.get('name')
    roll_no = data.get('roll_no')
    department = data.get('department')

    if not name or not roll_no or not department:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO students (name, roll_no, department) VALUES (%s, %s, %s)", (name, roll_no, department))
        conn.commit()
        return jsonify({'message': 'Student added successfully', 'id': cursor.lastrowid}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/students/<int:id>', methods=['PUT'])
def update_student(id):
    data = request.json
    name = data.get('name')
    roll_no = data.get('roll_no')
    department = data.get('department')

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE students SET name=%s, roll_no=%s, department=%s WHERE id=%s", (name, roll_no, department, id))
        conn.commit()
        return jsonify({'message': 'Student updated successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/students/<int:id>', methods=['DELETE'])
def delete_student(id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM students WHERE id=%s", (id,))
        conn.commit()
        return jsonify({'message': 'Student deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# ----------------- SUBJECTS -----------------

@app.route('/api/subjects', methods=['GET'])
def get_subjects():
    student_id = request.args.get('student_id')
    conn = get_db_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        if student_id:
            cursor.execute("SELECT * FROM subjects WHERE student_id=%s ORDER BY id DESC", (student_id,))
        else:
            cursor.execute("SELECT subjects.*, students.name as student_name FROM subjects JOIN students ON subjects.student_id = students.id ORDER BY subjects.id DESC")
        subjects = cursor.fetchall()
        return jsonify(subjects), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/subjects', methods=['POST'])
def add_subject():
    data = request.json
    student_id = data.get('student_id')
    subject_name = data.get('subject_name')
    
    if not student_id or not subject_name:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO subjects (student_id, subject_name, total_classes, attended_classes) VALUES (%s, %s, 0, 0)", (student_id, subject_name))
        conn.commit()
        return jsonify({'message': 'Subject added successfully', 'id': cursor.lastrowid}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# ----------------- ATTENDANCE -----------------

@app.route('/api/attendance', methods=['POST'])
def mark_attendance():
    data = request.json
    student_id = data.get('student_id')
    subject_id = data.get('subject_id')
    date = data.get('date')
    status = data.get('status') # 'present' or 'absent'

    if not all([student_id, subject_id, date, status]):
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        # Insert attendance record (handles unique constraint on date per subject/student)
        try:
            cursor.execute("INSERT INTO attendance (student_id, subject_id, date, status) VALUES (%s, %s, %s, %s)", 
                           (student_id, subject_id, date, status))
        except Exception as e:
            return jsonify({'error': 'Attendance already marked for this date, or invalid data.'}), 400

        # Update subject totals
        if status == 'present':
            cursor.execute("UPDATE subjects SET total_classes = total_classes + 1, attended_classes = attended_classes + 1 WHERE id=%s", (subject_id,))
        else:
            cursor.execute("UPDATE subjects SET total_classes = total_classes + 1 WHERE id=%s", (subject_id,))
            
        conn.commit()
        return jsonify({'message': 'Attendance marked successfully'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/attendance/history', methods=['GET'])
def get_attendance_history():
    student_id = request.args.get('student_id')
    subject_id = request.args.get('subject_id')
    
    if not student_id or not subject_id:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM attendance WHERE student_id=%s AND subject_id=%s ORDER BY date ASC", (student_id, subject_id))
        records = cursor.fetchall()
        return jsonify(records), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# ----------------- ELIGIBILITY -----------------

@app.route('/api/eligibility', methods=['GET'])
def get_eligibility():
    subject_name = request.args.get('subject_name')
    if not subject_name:
        return jsonify({'error': 'subject_name is required'}), 400
        
    conn = get_db_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        # Find students taking this subject who have < 75% attendance
        query = """
        SELECT s.id, s.name, sub.subject_name, sub.total_classes, sub.attended_classes
        FROM students s
        JOIN subjects sub ON s.id = sub.student_id
        WHERE sub.subject_name = %s AND sub.total_classes > 0
        """
        cursor.execute(query, (subject_name,))
        students = cursor.fetchall()
        
        at_risk = []
        for student in students:
            total = student['total_classes']
            attended = student['attended_classes']
            percentage = (attended / total) * 100
            if percentage < 75:
                # Formula: classes_needed = ceil((0.75 * total - attended) / (1 - 0.75))
                # Note: This is deterministic formula-based logic.
                import math
                classes_needed = math.ceil((0.75 * total - attended) / 0.25)
                
                student['percentage'] = percentage
                student['classes_needed'] = classes_needed
                at_risk.append(student)
                
        # Sort by classes needed (descending)
        at_risk.sort(key=lambda x: x['classes_needed'], reverse=True)
        
        return jsonify(at_risk), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# ----------------- DASHBOARD STATS -----------------

@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    conn = get_db_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        
        # 1. Subject averages
        cursor.execute("""
            SELECT subject_name, SUM(attended_classes) as total_attended, SUM(total_classes) as grand_total
            FROM subjects
            GROUP BY subject_name
            HAVING grand_total > 0
        """)
        subject_stats = cursor.fetchall()
        averages = [{'subject_name': s['subject_name'], 'average': (s['total_attended'] / s['grand_total']) * 100} for s in subject_stats]
        
        # 2. Most irregular students (overall lowest percentage across all subjects)
        cursor.execute("""
            SELECT s.name, s.department, SUM(sub.attended_classes) as t_att, SUM(sub.total_classes) as t_tot
            FROM students s
            JOIN subjects sub ON s.id = sub.student_id
            GROUP BY s.id
            HAVING t_tot > 0
        """)
        student_stats = cursor.fetchall()
        irregular = []
        for s in student_stats:
            perc = (s['t_att'] / s['t_tot']) * 100
            irregular.append({'name': s['name'], 'department': s['department'], 'percentage': perc})
        
        irregular.sort(key=lambda x: x['percentage'])
        irregular = irregular[:5] # Top 5 irregular
        
        return jsonify({'averages': averages, 'irregular': irregular}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == '__main__':
    app.run(debug=True, port=5000)
