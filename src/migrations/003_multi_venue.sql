CREATE TABLE IF NOT EXISTS sg_venues (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  city VARCHAR(100),
  logo_url TEXT,
  uht_venue_id INT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE sg_events ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES sg_venues(id);
ALTER TABLE sg_users ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES sg_venues(id);
