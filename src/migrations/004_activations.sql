CREATE TABLE IF NOT EXISTS sg_activations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sg_participants (
  id SERIAL PRIMARY KEY,
  activation_id INT REFERENCES sg_activations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(activation_id, slug)
);

CREATE TABLE IF NOT EXISTS sg_activation_votes (
  id SERIAL PRIMARY KEY,
  participant_id INT REFERENCES sg_participants(id) ON DELETE CASCADE,
  activation_id INT REFERENCES sg_activations(id) ON DELETE CASCADE,
  vote VARCHAR(20) NOT NULL CHECK (vote IN ('rules', 'hell_yeah', 'no_thanks')),
  browser_fingerprint TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sg_activation_optins (
  id SERIAL PRIMARY KEY,
  activation_id INT REFERENCES sg_activations(id) ON DELETE CASCADE,
  participant_id INT REFERENCES sg_participants(id) ON DELETE CASCADE,
  phone VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
