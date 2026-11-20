CREATE TABLE student_avatars (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  image BLOB NOT NULL
);
