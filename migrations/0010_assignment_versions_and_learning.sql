ALTER TABLE assignments ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assignments ADD COLUMN recording_seconds INTEGER NOT NULL DEFAULT 180;
ALTER TABLE assignments ADD COLUMN cefr TEXT NOT NULL DEFAULT 'A2';
ALTER TABLE assignments ADD COLUMN identity_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentences ADD COLUMN recording_seconds INTEGER;
ALTER TABLE sessions ADD COLUMN assignment_language TEXT;
ALTER TABLE sessions ADD COLUMN assignment_cefr TEXT NOT NULL DEFAULT 'A2';
ALTER TABLE answers ADD COLUMN question_position INTEGER;
ALTER TABLE answers ADD COLUMN question_text TEXT;
ALTER TABLE answers ADD COLUMN question_pinyin TEXT;
ALTER TABLE answers ADD COLUMN max_attempts_snapshot INTEGER;
ALTER TABLE answers ADD COLUMN recording_seconds_snapshot INTEGER;

UPDATE sessions SET assignment_language = (SELECT language FROM assignments WHERE id=sessions.assignment_id);
UPDATE assignments SET identity_locked = 1 WHERE EXISTS(SELECT 1 FROM sessions WHERE assignment_id=assignments.id);
UPDATE answers SET
  question_position = (SELECT position FROM sentences WHERE id=answers.sentence_id),
  question_text = (SELECT text FROM sentences WHERE id=answers.sentence_id),
  question_pinyin = (SELECT pinyin FROM sentences WHERE id=answers.sentence_id),
  max_attempts_snapshot = (SELECT COALESCE(se.max_attempts,a.max_attempts) FROM sentences se JOIN assignments a ON a.id=se.assignment_id WHERE se.id=answers.sentence_id),
  recording_seconds_snapshot = 180;

CREATE TRIGGER validate_assignment_revision BEFORE UPDATE OF revision ON assignments
WHEN NEW.revision != OLD.revision + 1 OR OLD.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'assignment_revision_conflict');
END;

CREATE TRIGGER lock_assignment_identity BEFORE UPDATE OF revision ON assignments
WHEN (NEW.identity_mode IS NOT OLD.identity_mode OR NEW.deidentify_voice != OLD.deidentify_voice)
  AND OLD.identity_locked=1
BEGIN
  SELECT RAISE(ABORT,'assignment_identity_locked');
END;

CREATE TRIGGER mark_assignment_started AFTER INSERT ON sessions
BEGIN
  UPDATE assignments SET identity_locked=1 WHERE id=NEW.assignment_id AND identity_locked=0;
END;

CREATE TABLE assignment_recipients (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id,student_id)
);
CREATE INDEX assignment_recipients_student ON assignment_recipients(student_id,assignment_id);
CREATE TABLE teacher_gemini (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  key_ciphertext TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL
);
CREATE TABLE vocabulary_cards (
  id TEXT PRIMARY KEY,
  sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  context_hash TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(sentence_id,context_hash,start_offset,end_offset)
);
CREATE TABLE student_vocabulary (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  content TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY(student_id,card_id)
);
CREATE TABLE question_audio (
  sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  context_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  PRIMARY KEY(sentence_id,context_hash)
);
