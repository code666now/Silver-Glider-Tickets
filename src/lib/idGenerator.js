const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return result;
}

function generateOrderNumber() {
  return `SGC-${generateCode(6)}`;
}

function generateTicketId() {
  return `SGT-${generateCode(6)}`;
}

module.exports = { generateOrderNumber, generateTicketId };
