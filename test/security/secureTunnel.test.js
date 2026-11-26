// Configuración propia de esta prueba (node --test ejecuta cada archivo en su propio proceso)
const crypto = require('crypto');
process.env.CRYPTO_MASTER_KEY = crypto.randomBytes(32).toString('hex');
process.env.DH_PRIME_HEX = crypto.getDiffieHellman('modp14').getPrime('hex');
process.env.DH_GENERATOR = '2';
process.env.SECURE_DIAGNOSTICS_ENABLED = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'clave-de-prueba';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const express = require('express');
const secureRoutes = require('../../src/routes/secureRoutes');
const errorHandler = require('../../src/middlewares/error');
const { createSecureTunnel } = require('../../src/middlewares/secureTunnel');
const { getSecurity } = require('../../src/security');
const { sendFile } = require('../../src/utils/httpFile');
const { createGroup, generateKeyPair, computeSharedSecret } = require('../../src/security/primitives/diffieHellman');
const {
  DIRECTIONS, deriveSessionKeys, sealFrame, openFrame, packMessage, unpackMessage
} = require('../../src/security/transport/transportCipher');
const { sha256 } = require('../../src/security/primitives/sha256');
const { fromBase64, toBase64, toHex, utf8Encode, utf8Decode } = require('../../src/security/primitives/bytes');

/**
 * Servidor como el real (túnel antes de express.json) con rutas de prueba, y un cliente que hace
 * lo mismo que el navegador: Diffie-Hellman y cada petición cifrada con ChaCha20 dentro del túnel.
 */

let server;
let baseUrl;
let tempFile;
const LARGE_FILE = crypto.randomBytes(3 * 1024 * 1024);

before(async () => {
  tempFile = path.join(os.tmpdir(), `tunel-${Date.now()}.bin`);
  await fsp.writeFile(tempFile, LARGE_FILE);

  const app = express();
  app.use(createSecureTunnel({ getSessionStore: () => getSecurity().sessionStore, maxBytes: 16 * 1024 * 1024, required: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/secure', secureRoutes);
  app.get('/api/health', (req, res) => res.json({ status: 'UP' }));
  app.post('/api/prueba/eco', (req, res) => res.status(201).json({
    body: req.body, auth: req.headers.authorization || null, query: req.query
  }));
  app.get('/api/prueba/archivo', (req, res, next) => sendFile(res, {
    fileName: 'Introducción.pdf', contentType: 'application/pdf', disposition: 'inline', filePath: tempFile
  }).catch(next));
  app.delete('/api/prueba/error', () => {
    const error = new Error('Recurso inexistente');
    error.statusCode = 404;
    error.isOperational = true;
    throw error;
  });
  app.use(errorHandler);

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(tempFile, { force: true });
});

async function openSession() {
  const group = createGroup(process.env.DH_PRIME_HEX, '2');
  const client = generateKeyPair(group);
  const response = await fetch(`${baseUrl}/secure/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientPublicKey: toBase64(client.publicKey) })
  });
  assert.equal(response.status, 201);
  const { sessionId, serverPublicKey } = await response.json();
  const serverPublic = fromBase64(serverPublicKey);
  return { sessionId, keys: deriveSessionKeys(computeSharedSecret(group, client.privateKey, serverPublic), client.publicKey, serverPublic) };
}

function buildFrame(session, { method = 'GET', url, headers = {}, body, ts = Date.now() }) {
  const rid = crypto.randomUUID();
  const bodyBytes = body === undefined ? new Uint8Array(0) : utf8Encode(typeof body === 'string' ? body : JSON.stringify(body));
  const meta = { rid, ts, method, url, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers } };
  return { rid, frame: sealFrame(session.keys, session.sessionId, DIRECTIONS.CLIENT_TO_SERVER, packMessage(meta, bodyBytes)) };
}

async function postFrame(session, frame) {
  return fetch(`${baseUrl}/secure/tunnel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Secure-Session': session.sessionId },
    body: frame
  });
}

/** Petición completa por el túnel, como secureFetch del navegador. */
async function tunnel(session, request) {
  const { rid, frame } = buildFrame(session, request);
  const outer = await postFrame(session, frame);
  assert.equal(outer.status, 200, `respuesta externa ${outer.status}`);
  assert.equal(outer.headers.get('content-type'), 'application/octet-stream');
  const sealed = new Uint8Array(await outer.arrayBuffer());
  const { meta, body } = unpackMessage(openFrame(session.keys, session.sessionId, DIRECTIONS.SERVER_TO_CLIENT, sealed));
  assert.equal(meta.rid, rid);
  return { status: meta.status, headers: meta.headers, body: Buffer.from(body), sealed };
}

describe('Túnel cifrado (ChaCha20) para toda la API', () => {
  it('lleva método, ruta, query, token y cuerpo cifrados hasta la ruta real', async () => {
    const session = await openSession();
    const { status, body, sealed } = await tunnel(session, {
      method: 'POST', url: '/api/prueba/eco?filtro=activo', headers: { authorization: 'Bearer token-secreto' },
      body: { texto: 'Contraseña ñandú 😀' }
    });
    assert.equal(status, 201);
    assert.deepEqual(JSON.parse(body.toString('utf8')), {
      body: { texto: 'Contraseña ñandú 😀' }, auth: 'Bearer token-secreto', query: { filtro: 'activo' }
    });
    assert.ok(!Buffer.from(sealed).includes(Buffer.from('ñandú')), 'la respuesta viaja cifrada');
  });

  it('un archivo binario grande (3 MB, leído por stream) llega completo con sus cabeceras', async () => {
    const session = await openSession();
    const { status, headers, body } = await tunnel(session, { url: '/api/prueba/archivo' });
    assert.equal(status, 200);
    assert.equal(headers['content-type'], 'application/pdf');
    assert.match(headers['content-disposition'], /Introducci%C3%B3n\.pdf/);
    assert.ok(body.equals(LARGE_FILE));
  });

  it('los errores de la ruta también viajan cifrados con su código', async () => {
    const session = await openSession();
    const { status, body } = await tunnel(session, { method: 'DELETE', url: '/api/prueba/error' });
    assert.equal(status, 404);
    assert.equal(JSON.parse(body.toString()).error.message, 'Recurso inexistente');
  });

  it('flujo completo con un texto largo (~4 MB): ChaCha20 -> Huffman + AES -> ChaCha20', async () => {
    const session = await openSession();
    const line = '\\paragraph{Prueba} Línea con acentos áéíóú, $\\alpha+\\beta$ y emoji 🚀.\n';
    const content = line.repeat(Math.ceil((4 * 1024 * 1024) / Buffer.byteLength(line)));
    const { status, body } = await tunnel(session, { method: 'POST', url: '/api/secure/diagnostics/roundtrip', body: { content } });
    assert.equal(status, 200);
    const result = JSON.parse(body.toString('utf8'));
    assert.equal(result.content, content);
    assert.equal(result.report.receivedSha256, toHex(sha256(utf8Encode(content))));
    assert.equal(result.report.storageRoundtripOk, true);
    assert.ok(result.report.huffmanBytes < result.report.receivedBytes);
  });

  it('rechaza peticiones sin cifrar a la API (excepto el acuerdo de llave y /health)', async () => {
    const plain = await fetch(`${baseUrl}/prueba/eco`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(plain.status, 403);
    assert.equal((await plain.json()).error.code, 'SECURE_CHANNEL_REQUIRED');
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  });

  it('rechaza tramas alteradas, repetidas, viejas, de otra sesión o hacia rutas prohibidas', async () => {
    const session = await openSession();

    const { frame } = buildFrame(session, { url: '/api/health' });
    const tampered = new Uint8Array(frame);
    tampered[20] ^= 1;
    assert.equal((await postFrame(session, tampered)).status, 400);

    assert.equal((await postFrame(session, frame)).status, 200);
    assert.equal((await postFrame(session, frame)).status, 400, 'repetición');

    const old = buildFrame(session, { url: '/api/health', ts: Date.now() - 10 * 60 * 1000 }).frame;
    assert.equal((await postFrame(session, old)).status, 400, 'petición vieja');

    const nested = buildFrame(session, { method: 'POST', url: '/api/secure/handshake', body: {} }).frame;
    assert.equal((await postFrame(session, nested)).status, 400, 'ruta prohibida dentro del túnel');

    const expired = await postFrame({ ...session, sessionId: 'no-existe' }, frame);
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).error.code, 'SECURE_SESSION_EXPIRED');
  });

  it('una respuesta de la sesión no se puede descifrar con otra sesión', async () => {
    const a = await openSession();
    const b = await openSession();
    const { sealed } = await tunnel(a, { url: '/api/health' });
    assert.throws(() => openFrame(b.keys, b.sessionId, DIRECTIONS.SERVER_TO_CLIENT, sealed));
    assert.equal(utf8Decode(unpackMessage(openFrame(a.keys, a.sessionId, DIRECTIONS.SERVER_TO_CLIENT, sealed)).body), '{"status":"UP"}');
  });
});
