# AttendIQ - Predictive Attendance System

AttendIQ is a full-stack, department-level attendance management web application. It tracks subject-wise attendance, calculates shortage risks, and features a "what-if" predictive simulator to help students and faculty take action before attendance drops below critical thresholds.

## Features
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 Custom Properties (No frameworks)
- **Backend**: Python (Flask REST API)
- **Database**: MySQL
- **Design**: Premium card-based dashboard layout, dark mode, smooth transitions, unrestrained gamification elements, and interactive SVG rings.
- **Predictive Logic**: Deterministic calculation of "classes needed to reach 75%".
- **What-If Simulator**: Interactive slider to see the future impact of attendance.
- **Faculty Dashboard**: Chart.js integration, exam eligibility generator, and irregular student tracking.

---

## Setup Instructions

### 1. Database Setup (MySQL)
1. Ensure you have a MySQL server running (e.g., via XAMPP, WAMP, or standalone MySQL).
2. Open your MySQL client (e.g., phpMyAdmin, MySQL Workbench, or CLI).
3. Execute the SQL commands inside `backend/schema.sql` to create the `attendiq` database and the required tables (`students`, `subjects`, `attendance`).
4. (Optional) If your MySQL `root` user has a password, update the `password` field in `backend/db_config.py`. The default assumes no password (common for local XAMPP).

### 2. Backend Setup (Flask)
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   ```
3. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the Flask server:
   ```bash
   python app.py
   ```
   *The server should now be running at `http://127.0.0.1:5000`.*

### 3. Frontend Setup
1. Simply open the `frontend/index.html` file in your preferred modern web browser.
2. The frontend uses the `fetch` API to communicate directly with the local Flask server on port 5000. No local web server is strictly required for the frontend unless you run into strict CORS/file:// protocol issues (in which case, you can use VS Code's Live Server or Python's `python -m http.server`).

---

## Usage Guide
1. **Students Tab**: Start by adding a student. Click "View" to manage their subjects.
2. **Subject View**: Add subjects for the student. Click "Mark" to record present/absent data. The heatmap and predictions will update automatically.
3. **What-If Simulator**: Click "Simulator" on any subject to open the predictive UI and drag the slider.
4. **Eligibility Tab**: Type the exact name of a subject (e.g., "Math") to generate a list of students who are currently below the 75% attendance threshold.
5. **Dashboard Tab**: View overall averages and the most irregular students (populated automatically as you add attendance data). Use the toggle in the bottom left sidebar to switch to Dark Mode.
