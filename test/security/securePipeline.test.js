// Configuración propia de esta prueba (node --test ejecuta cada archivo en su propio proceso)
const crypto = require('crypto');
process.env.CRYPTO_MASTER_KEY = crypto.randomBytes(32).toString('hex');
process.env.DH_PRIME_HEX = crypto.getDiffieHellman('modp14').getPrime('hex');
process.env.DH_GENERATOR = '2';
process.env.SECURE_DIAGNOSTICS_ENABLED = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const secureRoutes = require('../../src/routes/secureRoutes');
const errorHandler = require('../../src/middlewares/error');
const { createGroup, generateKeyPair, computeSharedSecret } = require('../../src/security/primitives/diffieHellman');
const { DIRECTIONS, deriveSessionKeys, sealJson, openJson, sealFrame, openFrame } = require('../../src/security/transport/transportCipher');
const { sha256 } = require('../../src/security/primitives/sha256');
const { fromBase64, toBase64, toHex, utf8Encode } = require('../../src/security/primitives/bytes');

/**
 * Prueba de punta a punta por HTTP, haciendo de navegador:
 * Diffie-Hellman -> ChaCha20 -> (servidor: Huffman + AES y de vuelta) -> ChaCha20.
 */

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/secure', secureRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/secure`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function openSession() {
  const group = createGroup(process.env.DH_PRIME_HEX, '2');
  const client = generateKeyPair(group);
  const response = await fetch(`${baseUrl}/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientPublicKey: toBase64(client.publicKey) })
  });
  assert.equal(response.status, 201);
  const { sessionId, serverPublicKey } = await response.json();
  const serverPublic = fromBase64(serverPublicKey);
  const shared = computeSharedSecret(group, client.privateKey, serverPublic);
  return { sessionId, keys: deriveSessionKeys(shared, client.publicKey, serverPublic) };
}

async function sendEncrypted(session, payload, envelopeOverride) {
  const envelope = envelopeOverride || sealJson(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, payload);
  const response = await fetch(`${baseUrl}/diagnostics/roundtrip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Secure-Session': session.sessionId },
    body: JSON.stringify(envelope)
  });
  return { response, envelope };
}

describe('Flujo cifrado completo por HTTP', () => {
  it('un texto viaja cifrado, se guarda comprimido y cifrado, y vuelve idéntico', async () => {
    const session = await openSession();
    const content = 'Hola \\LaTeX, ñandú 😀';
    const { response, envelope } = await sendEncrypted(session, { content });

    assert.ok(!JSON.stringify(envelope).includes('ñandú'), 'el cuerpo enviado no debe ir en claro');
    assert.equal(response.status, 200);

    const raw = await response.json();
    assert.ok(raw.nonce && raw.data && raw.tag, 'la respuesta debe llegar cifrada');
    const body = openJson(session.keys, session.sessionId, DIRECTIONS.SERVER_TO_CLIENT, raw);

    assert.equal(body.content, content);
    assert.equal(body.report.storageRoundtripOk, true);
    assert.equal(body.report.receivedSha256, toHex(sha256(utf8Encode(content))));
  });

  it('no pierde nada con un mensaje largo (~4 MB)', async () => {
    const session = await openSession();
    const line = '\\paragraph{Prueba} Línea con acentos áéíóú, símbolos $\\alpha+\\beta$ y emoji 🚀.\n';
    const content = line.repeat(Math.ceil((4 * 1024 * 1024) / Buffer.byteLength(line)));
    const { response } = await sendEncrypted(session, { content });
    assert.equal(response.status, 200);

    const body = openJson(session.keys, session.sessionId, DIRECTIONS.SERVER_TO_CLIENT, await response.json());
    assert.equal(body.content.length, content.length);
    assert.equal(body.content, content);
    assert.equal(body.report.receivedBytes, Buffer.byteLength(content));
    assert.equal(body.report.receivedSha256, toHex(sha256(utf8Encode(content))));
    assert.ok(body.report.huffmanBytes < body.report.receivedBytes);
    assert.equal(body.report.storageRoundtripOk, true);
  });

  it('rechaza un mensaje alterado en el camino', async () => {
    const session = await openSession();
    const envelope = sealJson(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, { content: 'original' });
    const data = fromBase64(envelope.data);
    data[0] ^= 0x01;
    const { response } = await sendEncrypted(session, null, { ...envelope, data: toBase64(data) });
    assert.equal(response.status, 400);
  });

  it('rechaza reenviar el mismo mensaje cifrado (repetición)', async () => {
    const session = await openSession();
    const envelope = sealJson(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, { content: 'una vez' });
    assert.equal((await sendEncrypted(session, null, envelope)).response.status, 200);
    assert.equal((await sendEncrypted(session, null, envelope)).response.status, 400);
  });

  it('rechaza una sesión desconocida', async () => {
    const session = await openSession();
    const { response } = await sendEncrypted({ ...session, sessionId: 'no-existe' }, { content: 'x' });
    assert.equal(response.status, 401);
  });

  it('rechaza un valor público de Diffie-Hellman inválido', async () => {
    const response = await fetch(`${baseUrl}/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientPublicKey: toBase64(Uint8Array.of(1)) })
    });
    assert.equal(response.status, 400);
  });
});

describe('Tramas binarias (edición en tiempo real)', () => {
  it('cifra y descifra tramas en ambas direcciones y detecta truncamiento', async () => {
    const session = await openSession();
    const update = crypto.randomBytes(200000);
    const frame = sealFrame(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, update);
    assert.deepEqual(openFrame(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, frame), new Uint8Array(update));
    assert.throws(() => openFrame(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, frame.subarray(0, frame.length - 1)));
    // Un mensaje del cliente no se acepta como si viniera del servidor
    assert.throws(() => openFrame(session.keys, session.sessionId, DIRECTIONS.SERVER_TO_CLIENT, frame));
  });
});
