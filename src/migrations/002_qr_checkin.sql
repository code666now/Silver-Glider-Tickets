ALTER TABLE sg_tickets ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE sg_tickets ADD COLUMN IF NOT EXISTS checkin_method VARCHAR(20);
ALTER TABLE sg_tickets ADD COLUMN IF NOT EXISTS checked_in_by INT REFERENCES sg_users(id);

UPDATE sg_tickets SET qr_token = encode(gen_random_bytes(32), 'hex') WHERE qr_token IS NULL;
