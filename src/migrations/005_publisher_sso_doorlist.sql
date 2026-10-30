-- Acceso de publicadores (artist/partner/promoter/venue) por SSO desde el backend
-- principal + exportación de la lista de puerta. Idempotente: scripts/migrate.js
-- re-aplica todos los .sql en cada corrida.

-- Tokens SSO ya canjeados. El token del principal vive 5 min; guardar su jti hasta
-- que vence impide reusarlo si se filtra (historial, logs, captura de pantalla).
CREATE TABLE IF NOT EXISTS sg_sso_used_tokens (
  jti VARCHAR(128) PRIMARY KEY,
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sg_sso_used_tokens_expires ON sg_sso_used_tokens (expires_at);

-- Registro de exportaciones de la lista de puerta: el archivo puede llevar email y
-- teléfono de los compradores, así que queda constancia de quién lo bajó y con qué campos.
-- actor_kind: 'staff' (usuario local sg_users) | 'publisher' (usuario del principal).
CREATE TABLE IF NOT EXISTS sg_doorlist_exports (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES sg_events(id),
  actor_kind VARCHAR(20) NOT NULL,
  actor_ref VARCHAR(64) NOT NULL,
  actor_email VARCHAR(255),
  format VARCHAR(10) NOT NULL,
  include_email BOOLEAN NOT NULL DEFAULT false,
  include_phone BOOLEAN NOT NULL DEFAULT false,
  row_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sg_doorlist_exports_event ON sg_doorlist_exports (event_id, created_at);
