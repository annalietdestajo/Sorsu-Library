const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const XLSX = require("xlsx");

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./database.db");

// --- CREATE TABLES ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS students (
      student_number TEXT PRIMARY KEY,
      full_name TEXT,
      course TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS visitor_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_number TEXT,
      visit_time TEXT
  )`);
});

// --- ADD STUDENT ---
app.post("/student", (req, res) => {
  const { student_number, full_name, course } = req.body;
  db.run(
    `INSERT OR IGNORE INTO students(student_number, full_name, course) VALUES (?,?,?)`,
    [student_number, full_name, course],
    err => {
      if (err) return res.status(400).json(err);
      res.json({ message: "Student added" });
    }
  );
});

// --- DELETE STUDENT ---
app.delete("/student/:id", (req, res) => {
  const id = req.params.id;
  db.run(
    `DELETE FROM students WHERE student_number = ?`,
    [id],
    function(err) {
      if (err) return res.status(500).json(err);
      res.json({ message: "Student deleted" });
    }
  );
});

// --- CHECK-IN ---
app.post("/checkin", (req, res) => {
  const { student_number } = req.body;
  const time = new Date().toISOString();

  db.get(`SELECT * FROM students WHERE student_number = ?`, [student_number], (err, student) => {
    if (err) return res.status(500).json(err);
    if (!student) return res.status(404).json({ message: "Student not found" });

    db.run(
      `INSERT INTO visitor_log(student_number, visit_time) VALUES (?, ?)`,
      [student_number, time],
      err => {
        if (err) return res.status(500).json(err);
        res.json({ message: `Checked in: ${student.full_name}`, student });
      }
    );
  });
});

// --- GET STUDENTS ---
app.get("/students", (req, res) => {
  db.all(`SELECT * FROM students ORDER BY full_name`, [], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows || []);
  });
});

// --- GET VISITS ---
app.get("/visits", (req, res) => {
  const search = req.query.search || "";
  db.all(
    `
    SELECT v.id, s.student_number, s.full_name, s.course, v.visit_time
    FROM visitor_log v
    JOIN students s ON v.student_number = s.student_number
    WHERE s.student_number LIKE ? OR s.full_name LIKE ? OR s.course LIKE ?
    ORDER BY v.visit_time DESC
    LIMIT 50
  `,
    [`%${search}%`, `%${search}%`, `%${search}%`],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows || []);
    }
  );
});

// --- EXPORT STUDENTS TO EXCEL ---
app.get("/export/students", (req, res) => {
  db.all(`SELECT * FROM students ORDER BY full_name`, [], (err, rows) => {
    if (err) return res.status(500).json(err);

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", "attachment; filename=students.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  });
});

// --- EXPORT VISITS TO EXCEL ---
app.get("/export/visits", (req, res) => {
  db.all(
    `SELECT s.student_number, s.full_name, s.course, v.visit_time
     FROM visitor_log v
     JOIN students s ON v.student_number = s.student_number
     ORDER BY v.visit_time DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json(err);

      const worksheet = XLSX.utils.json_to_sheet(
        rows.map(r => ({
          "Student Number": r.student_number,
          "Full Name": r.full_name,
          "Course": r.course,
          "Date & Time": new Date(r.visit_time).toLocaleString()
        }))
      );

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Visits");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", "attachment; filename=visits.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    }
  );
});

// --- REPORTS ---
app.get("/reports", (req, res) => {
  const reports = {};

  db.get(`SELECT COUNT(*) AS total_students FROM students`, [], (err, row) => {
    if (err) return res.status(500).json(err);
    reports.total_students = row.total_students;

    db.get(`SELECT COUNT(*) AS total_visits FROM visitor_log`, [], (err, row2) => {
      if (err) return res.status(500).json(err);
      reports.total_visits = row2.total_visits;

      db.get(
        `SELECT course, COUNT(*) AS count
         FROM visitor_log v
         JOIN students s ON v.student_number = s.student_number
         GROUP BY course
         ORDER BY count DESC
         LIMIT 1`,
        [],
        (err, row3) => {
          reports.top_course = row3 ? row3.course : "N/A";

          db.get(
            `SELECT substr(visit_time,1,7) AS month, COUNT(*) AS count
             FROM visitor_log
             GROUP BY month
             ORDER BY count DESC
             LIMIT 1`,
            [],
            (err, row4) => {
              reports.peak_month = row4 ? row4.month : "N/A";
              res.json(reports);
            }
          );
        }
      );
    });
  });
});

// Clear all students
app.post("/clear_students", (req, res) => {
  db.run(`DELETE FROM students`, [], function(err){
    if(err) return res.status(500).json({ error: "Failed to clear students" });
    res.json({ success: true, message: "All students cleared" });
  });
});

// Clear all visits
app.post("/clear_visits", (req, res) => {
  db.run(`DELETE FROM visitor_log`, [], function(err){
    if(err) return res.status(500).json({ error: "Failed to clear visits" });
    res.json({ success: true, message: "All visits cleared" });
  });
});

// --- CLEAR STUDENTS ---
app.post("/clear_students", (req,res)=>{
  db.run(`DELETE FROM students`, [], err=>{
    if(err) return res.status(500).json(err);
    res.json({ message: "Students cleared" });
  });
});

// --- CLEAR VISITS ---
app.post("/clear_visits", (req,res)=>{
  db.run(`DELETE FROM visitor_log`, [], err=>{
    if(err) return res.status(500).json(err);
    res.json({ message: "Visits cleared" });
  });
});

// --- RESTORE VISITS (with original visit_time) ---
app.post("/restore/visits", (req,res)=>{
  const visits = req.body; // [{student_number, visit_time}]
  const stmt = db.prepare(`INSERT INTO visitor_log(student_number, visit_time) VALUES (?, ?)`);
  
  db.serialize(()=>{
    visits.forEach(v => stmt.run([v.student_number, v.visit_time]));
    stmt.finalize(err=>{
      if(err) return res.status(500).json(err);
      res.json({ message: "Visits restored successfully" });
    });
  });
});





// --- START SERVER ---
app.listen(5000, () => console.log("Server running at http://localhost:5000"));

app.post("/admin/login",(req,res)=>{
  const { username,password } = req.body;

  if(username==="admin" && password==="1234"){
    res.json({success:true});
  }else{
    res.json({success:false});
  }
});
