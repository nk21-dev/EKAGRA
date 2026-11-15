const crypto = require('node:crypto');

const SALT = 'ekagra_ai_encryption_salt_v1';

/**
 * Derives a 32-byte key from the server encryption secret.
 */
function deriveKey(secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('Encryption secret must be a non-empty string.');
  }
  return crypto.scryptSync(secret, SALT, 32);
}

/**
 * Encrypts a plaintext string (API Key) using AES-256-GCM.
 * Format: ivHex:tagHex:cipherHex
 */
function encryptApiKey(plaintext, secret) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext key is required.');
  }
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12); // Recommended 12 bytes for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 */
function decryptApiKey(encryptedPayload, secret) {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Encrypted payload is required.');
  }
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format.');
  }

  const [ivHex, tagHex, dataHex] = parts;
  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(dataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Masks an API key for safe UI display (e.g. "ekag••••••••cdef").
 * Never exposes the full plaintext key.
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

module.exports = {
  encryptApiKey,
  decryptApiKey,
  maskApiKey
};
