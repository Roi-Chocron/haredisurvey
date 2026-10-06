-- Migration: 001_create_tables
CREATE TABLE IF NOT EXISTS amana_signatures (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  hide_name BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_votes (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  votes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_phone ON survey_votes(phone);
