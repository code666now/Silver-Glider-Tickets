// Cliente de solo-lectura hacia el backend principal, para resolver eventos por id
// externo cuando el micro aún no los tiene mapeados (pull-on-import).
const PRINCIPAL_URL = (process.env.PRINCIPAL_URL || '').replace(/\/$/, '');

const FETCH_TIMEOUT_MS = 8000;

/**
 * Trae un evento del principal por su id (= external_event_id en el micro).
 * @param {string|number} externalEventId
 * @returns {Promise<Object|null>} el objeto `evento` del principal, o null si no existe.
 */
async function fetchEventoFromPrincipal(externalEventId) {
  if (!PRINCIPAL_URL) {
    console.warn('⚠️  PRINCIPAL_URL no configurada; no se puede auto-resolver el evento.');
    return null;
  }

  const url = `${PRINCIPAL_URL}/api/eventos/${encodeURIComponent(externalEventId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[principalClient] GET ${url} → ${res.status}`);
      return null;
    }
    const body = await res.json();
    return body?.evento || null;
  } catch (err) {
    console.error(`[principalClient] fallo al traer evento ${externalEventId}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchEventoFromPrincipal };
