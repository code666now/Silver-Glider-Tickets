// SSO desde el backend principal para usuarios que publican eventos
// (artist/partner/promoter/venue). Contrato del token: ver feat-microservicio.md.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SSO_ISSUER = 'silver-glider-principal';
const SSO_AUDIENCE = 'silver-glider-tickets';
const SSO_MAX_AGE = '5m';

// Roles locales del micro: nunca se aceptan desde el principal, aunque alguien los
// agregue a SSO_ALLOWED_ROLES. Una sesión de publicador no debe valer como admin/staff.
const RESERVED_ROLES = new Set(['admin', 'staff']);

// Se lee en cada llamada para que un cambio de SSO_ALLOWED_ROLES aplique también a las
// sesiones ya abiertas (requireStaffOrPublisher lo vuelve a comprobar en cada request).
function allowedPublisherRoles() {
  return (process.env.SSO_ALLOWED_ROLES || 'artist,partner,promoter,venue')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r && !RESERVED_ROLES.has(r));
}

function isPublisherRoleAllowed(role) {
  return allowedPublisherRoles().includes(String(role || '').toLowerCase());
}

function ssoError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Verifica el token firmado por el principal y devuelve sus claims normalizados.
function verifyPrincipalToken(token) {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) throw ssoError('SSO not configured', 503);

  let claims;
  try {
    claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: SSO_ISSUER,
      audience: SSO_AUDIENCE,
      maxAge: SSO_MAX_AGE,
    });
  } catch {
    throw ssoError('Invalid or expired SSO token', 401);
  }

  if (!claims.sub || !claims.jti || !claims.exp) throw ssoError('Malformed SSO token', 401);
  if (!isPublisherRoleAllowed(claims.role)) throw ssoError('Role not allowed', 403);
  if (!Array.isArray(claims.eventIds)) throw ssoError('Malformed SSO token', 401);

  return {
    jti: String(claims.jti),
    expiresAt: new Date(claims.exp * 1000),
    externalUserId: String(claims.sub),
    role: String(claims.role).toLowerCase(),
    email: claims.email || null,
    firstName: claims.name || null,
    eventIds: claims.eventIds.map(String),
  };
}

// Sesión local del publicador. `kind: 'publisher'` la separa de las sesiones de
// sg_users: requireAuth la rechaza, y no lleva `id` para que nunca se confunda con un
// sg_users.id (p. ej. en checked_in_by).
function issuePublisherSession(sso) {
  const hours = Number(process.env.SSO_SESSION_HOURS) || 4;
  return jwt.sign(
    {
      kind: 'publisher',
      sub: sso.externalUserId,
      role: sso.role,
      email: sso.email,
      first_name: sso.firstName,
      eventIds: sso.eventIds,
      sid: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: `${hours}h` }
  );
}

module.exports = {
  SSO_ISSUER, SSO_AUDIENCE,
  allowedPublisherRoles, isPublisherRoleAllowed,
  verifyPrincipalToken, issuePublisherSession,
};
