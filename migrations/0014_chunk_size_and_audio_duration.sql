ALTER TABLE assignments ADD COLUMN chunk_size TEXT NOT NULL DEFAULT 'small' CHECK (chunk_size IN ('small', 'medium', 'large'));
ALTER TABLE attempts ADD COLUMN duration_seconds REAL;
