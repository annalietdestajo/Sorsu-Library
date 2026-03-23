const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const cors = require("cors");
const XLSX = require("xlsx");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// --- Frontend routes ---
app.use(express.static(path.join(__dirname, "FRONTEND")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "FRONTEND", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "FRONTEND", "admin-login.html")));

// --- ADD STUDENT ---
app.post("/student", async (req, res) => {
  const { student_number, last_name, first_name, middle_name, course } = req.body;

  const { data, error } = await supabase
    .from('students')
    .insert([{ student_number, last_name, first_name, middle_name, course }])
    .select();

  if (error) return res.status(400).json(error);
  res.json({ message: "Student added", student: data[0] });
});

// --- UPDATE STUDENT ---
app.put("/student/:id", async (req, res) => {
  const id = req.params.id;
  const { last_name, first_name, middle_name, course } = req.body;
  const { data, error } = await supabase
    .from('students')
    .update({ last_name, first_name, middle_name, course })
    .eq('student_number', id)
    .select();
  if (error) return res.status(500).json(error);
  res.json({ message: "Student updated", student: data[0] });
});

// --- DELETE STUDENT ---
app.delete("/student/:id", async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase
    .from('students')
    .delete()
    .eq('student_number', id);
  if (error) return res.status(500).json(error);
  res.json({ message: "Student deleted" });
});

// --- CHECK-IN ---
app.post("/checkin", async (req, res) => {
  const { student_number } = req.body;

  
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('*')
    .eq('student_number', student_number)
    .single();

  if (studentErr || !student) {
    return res.status(404).json({ message: "Student not found" });
  }

 
  const { error: visitErr } = await supabase
    .from('visits')
    .insert([{ student_number }]);  

  if (visitErr) return res.status(500).json(visitErr);

  const fullName = `${student.last_name}, ${student.first_name} ${student.middle_name || ""}`;
  
 
  res.json({ message: `Checked in: ${fullName}` });
});
// --- GET STUDENTS ---
app.get("/students", async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .order('last_name', { ascending: true });
  if (error) return res.status(500).json(error);
  res.json(data || []);
});

// --- GET VISITS ---
app.get("/visits", async (req, res) => {
  const { data, error } = await supabase
    .from('visits')
    .select(`
      id,
      student_number,
      students (
        last_name,
        first_name,
        middle_name,
        course
      ),
      date
    `);

  if (error) return res.status(500).json(error);

  const rows = data.map(v => ({
    id: v.id,
    student_number: v.student_number,
    full_name: `${v.students.last_name}, ${v.students.first_name} ${v.students.middle_name || ""}`,
    course: v.students.course,
    visit_time: v.date  
  }));

  res.json(rows);
});

// --- REPORTS ---
app.get("/reports", async (req, res) => {
  const { count: total_students, error: studentsErr } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true });
  if (studentsErr) return res.status(500).json(studentsErr);

  const { count: total_visits, data: visitsData, error: visitsErr } = await supabase
    .from('visitor_log')
    .select('*', { count: 'exact' });
  if (visitsErr) return res.status(500).json(visitsErr);

  const { data: topCourseData } = await supabase
    .from('visitor_log')
    .select('students(course)')
    .order('students.course', { ascending: false })
    .limit(1)
    .single();

  res.json({
    total_students,
    total_visits,
    top_course: topCourseData ? topCourseData.students.course : "N/A"
  });
});

// --- CLEAR ALL STUDENTS ---
app.post("/clear_students", async (req, res) => {
  const { error } = await supabase.from('students').delete();
  if (error) return res.status(500).json(error);
  res.json({ success: true, message: "All students cleared" });
});

// --- CLEAR ALL VISITS ---
app.post("/clear_visits", async (req, res) => {
  const { error } = await supabase.from('visitor_log').delete();
  if (error) return res.status(500).json(error);
  res.json({ success: true, message: "All visits cleared" });
});

// --- ADMIN LOGIN ---
app.post("/admin/login",(req,res)=>{
  const { username, password } = req.body;
  if(username==="admin" && password==="1234") res.json({success:true});
  else res.json({success:false});
});

// --- EXPORT STUDENTS & VISITS TO EXCEL ---
app.get("/export/students", async (req,res) => {
  const { data: students, error } = await supabase.from('students').select('*');
  if (error) return res.status(500).json(error);

  const ws = XLSX.utils.json_to_sheet(students.map(s => ({
    "Student Number": s.student_number,
    "Last Name": s.last_name,
    "First Name": s.first_name,
    "Middle Name": s.middle_name,
    "Course": s.course
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=students.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});

app.get("/export/visits", async (req,res) => {
  const { data: visits, error } = await supabase
    .from('visitor_log')
    .select(`
      id,
      student_number,
      students(last_name, first_name, middle_name, course),
      visit_time
    `);
  if (error) return res.status(500).json(error);

  const ws = XLSX.utils.json_to_sheet(visits.map(v => ({
    "Student Number": v.student_number,
    "Full Name": `${v.students.last_name}, ${v.students.first_name} ${v.students.middle_name || ""}`.trim(),
    "Course": v.students.course,
    "Date & Time": new Date(v.visit_time).toLocaleString()
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Visits");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=visits.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});

app.get("/test-supabase", async (req, res) => {
  try {
    const { data, error } = await supabase.from('students').select('*').limit(1);
    if (error) throw error;
    res.json({ success: true, count: data.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));