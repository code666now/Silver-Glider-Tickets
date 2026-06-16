ALTER TABLE sg_participants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'approved';
ALTER TABLE sg_participants ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE sg_participants ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
