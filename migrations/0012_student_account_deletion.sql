CREATE TABLE student_audio_deletions (
  r2_key TEXT PRIMARY KEY,
  student_id TEXT NOT NULL
);
CREATE INDEX idx_student_audio_deletions_student ON student_audio_deletions(student_id);

CREATE TRIGGER delete_student_data BEFORE DELETE ON students
BEGIN
  INSERT OR IGNORE INTO student_audio_deletions(r2_key, student_id)
    SELECT a.r2_key, OLD.id FROM attempts a JOIN sessions s ON s.id=a.session_id
    WHERE s.student_account_id=OLD.id;
  INSERT OR IGNORE INTO student_audio_deletions(r2_key, student_id)
    SELECT a.r2_key, OLD.id FROM feedback_audio a JOIN sessions s ON s.id=a.session_id
    WHERE s.student_account_id=OLD.id;
  DELETE FROM sessions WHERE student_account_id=OLD.id;
  DELETE FROM teacher_students WHERE student_id=OLD.id;
END;
