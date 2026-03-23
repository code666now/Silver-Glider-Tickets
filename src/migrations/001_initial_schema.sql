CREATE TABLE IF NOT EXISTS sg_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(20) NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sg_events (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  event_date TIMESTAMP,
  venue VARCHAR(255),
  capacity INT,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sg_event_staff (
  id SERIAL PRIMARY KEY,
  event_id INT REFERENCES sg_events(id),
  user_id INT REFERENCES sg_users(id)
);

CREATE TABLE IF NOT EXISTS sg_orders (
  id SERIAL PRIMARY KEY,
  event_id INT REFERENCES sg_events(id),
  order_number VARCHAR(20) UNIQUE NOT NULL,
  buyer_first_name VARCHAR(100),
  buyer_last_name VARCHAR(100),
  buyer_email VARCHAR(255),
  buyer_phone VARCHAR(50),
  total_amount DECIMAL(10,2),
  currency VARCHAR(10) DEFAULT 'USD',
  payment_status VARCHAR(20) DEFAULT 'paid',
  order_status VARCHAR(20) DEFAULT 'active',
  quantity INT DEFAULT 1,
  secure_token TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sg_tickets (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES sg_orders(id),
  event_id INT REFERENCES sg_events(id),
  ticket_id VARCHAR(20) UNIQUE NOT NULL,
  ticket_type VARCHAR(100) DEFAULT 'General Admission',
  attendee_first_name VARCHAR(100),
  attendee_last_name VARCHAR(100),
  ticket_status VARCHAR(20) DEFAULT 'valid',
  checkin_status VARCHAR(20) DEFAULT 'not_checked_in',
  checkin_at TIMESTAMP,
  qr_token TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
