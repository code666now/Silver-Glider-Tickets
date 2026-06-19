-- Acople con el backend principal (marketplace Stripe Connect).
-- Opción A: mapeo de eventos por id externo.
ALTER TABLE sg_events ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(64) UNIQUE;

-- Idempotencia de import: id de la Order (o payment_intent) del backend principal.
ALTER TABLE sg_orders ADD COLUMN IF NOT EXISTS external_order_id VARCHAR(64) UNIQUE;
