-- Estado de entrega del correo de confirmación, para reintentar los envíos fallidos.
-- El envío inicial ocurre en importOrder; si falla, el barredor (lib/emailRetry.js)
-- lo reintenta pasados EMAIL_RETRY_DELAY_MINUTES.

-- La primera vez que se añade email_sent_at hay que dar por enviadas las órdenes que
-- ya existían, o el barredor les mandaría un correo a todas al arrancar. El backfill
-- vive dentro del IF para que no se repita: scripts/migrate.js re-ejecuta todos los
-- .sql en cada corrida, y un UPDATE suelto marcaría como enviadas las órdenes que
-- estuvieran esperando reintento.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sg_orders' AND column_name = 'email_sent_at'
  ) THEN
    ALTER TABLE sg_orders ADD COLUMN email_sent_at TIMESTAMP;
    UPDATE sg_orders SET email_sent_at = created_at;
  END IF;
END $$;

ALTER TABLE sg_orders ADD COLUMN IF NOT EXISTS email_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE sg_orders ADD COLUMN IF NOT EXISTS email_last_attempt_at TIMESTAMP;
ALTER TABLE sg_orders ADD COLUMN IF NOT EXISTS email_last_error TEXT;

-- El barredor solo consulta órdenes pendientes; índice parcial para que no escanee
-- la tabla entera en cada tick.
CREATE INDEX IF NOT EXISTS idx_sg_orders_email_pending
  ON sg_orders (email_last_attempt_at)
  WHERE email_sent_at IS NULL;
