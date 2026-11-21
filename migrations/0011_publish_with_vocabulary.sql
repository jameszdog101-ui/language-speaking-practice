ALTER TABLE assignments ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'published' CHECK(publication_state IN ('draft', 'published'));
ALTER TABLE assignments ADD COLUMN creation_key TEXT;
ALTER TABLE assignments ADD COLUMN vocabulary_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assignments ADD COLUMN vocabulary_job_token TEXT;
ALTER TABLE assignments ADD COLUMN vocabulary_job_until TEXT;
ALTER TABLE assignments ADD COLUMN vocabulary_job_error TEXT;
ALTER TABLE sessions ADD COLUMN assignment_vocabulary_version INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX assignment_creation_request ON assignments(teacher_id, creation_key) WHERE creation_key IS NOT NULL;
