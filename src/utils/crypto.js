const crypto = require('crypto');

// Algoritmo de encriptación simétrica para proteger datos sensibles
const ALGORITHM = 'aes-256-cbc';
const KEY = crypto.randomBytes(32); // En producción, usa una clave persistente guardada en .env
const IV_LENGTH = 16;

/**
 * Encriptar un texto plano
 * @param {string} text 
 * @returns {string} texto encriptado en formato hex con IV
 */
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Desencriptar un texto cifrado
 * @param {string} encryptedText 
 * @returns {string} texto desencriptado plano
 */
function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};

