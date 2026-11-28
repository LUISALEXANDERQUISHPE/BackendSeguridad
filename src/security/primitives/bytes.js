/**
 * Utilidades de bytes compartidas por los algoritmos criptográficos.
 * Solo convierten y combinan datos: no cifran ni generan llaves.
 */

function utf8Encode(text) {
  return new Uint8Array(Buffer.from(String(text ?? ''), 'utf8'));
}

function utf8Decode(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

function toBase64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function fromBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error('Texto base64 inválido');
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

function toHex(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

function fromHex(hex) {
  const clean = String(hex ?? '').trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('Texto hexadecimal inválido');
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Entero sin signo de 32 bits en big-endian. */
function uint32BE(value) {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/**
 * Compara en tiempo constante (no se detiene en el primer byte distinto) para que
 * el tiempo de respuesta no revele cuántos bytes de una etiqueta eran correctos.
 */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

module.exports = {
  utf8Encode,
  utf8Decode,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  concatBytes,
  uint32BE,
  readUint32BE,
  constantTimeEqual
};
