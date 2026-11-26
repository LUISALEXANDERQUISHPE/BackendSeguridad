const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('../../src/security/primitives/random');
const { concatBytes, toHex, utf8Decode, utf8Encode } = require('../../src/security/primitives/bytes');
const { DIRECTIONS, sealFrame, openFrame } = require('../../src/security/transport/transportCipher');
const { createSessionStore } = require('../../src/security/transport/sessionStore');
const { openSecureChannel, SECURE_CLOSE_CODES } = require('../../src/realtime/secureChannel');

function fakeSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    closed: null,
    send(data) { this.sent.push(data); },
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
  };
}

function newSession(store) {
  const keys = {
    [DIRECTIONS.CLIENT_TO_SERVER]: { encryption: randomBytes(32), mac: randomBytes(32) },
    [DIRECTIONS.SERVER_TO_CLIENT]: { encryption: randomBytes(32), mac: randomBytes(32) }
  };
  return store.save(toHex(randomBytes(16)), keys);
}

/** Lo que hace el navegador: secuencia de 8 bytes + texto, cifrado para esta conexión. */
function clientFrame(session, channelId, sequence, text) {
  const seq = new Uint8Array(8);
  new DataView(seq.buffer).setBigUint64(0, BigInt(sequence));
  return sealFrame(session.keys, `${session.id}#${channelId}`, DIRECTIONS.CLIENT_TO_SERVER, concatBytes(seq, utf8Encode(text)));
}

describe('Canal cifrado del WebSocket (edición en tiempo real)', () => {
  it('descifra en orden lo que envía el navegador y cifra lo que responde el servidor', () => {
    const store = createSessionStore({ ttlMs: 60000 });
    const session = newSession(store);
    const channelId = toHex(randomBytes(16));
    const socket = fakeSocket();
    const channel = openSecureChannel(socket, `/api/collab?sid=${session.id}&cid=${channelId}`, store);

    const update = JSON.stringify({ type: 'update', update: Buffer.from(randomBytes(200000)).toString('base64') });
    assert.equal(channel.decrypt(clientFrame(session, channelId, 0, '{"type":"join"}'), true), '{"type":"join"}');
    assert.equal(channel.decrypt(clientFrame(session, channelId, 1, update), true), update);

    channel.send('{"type":"saved"}');
    const plaintext = openFrame(session.keys, `${session.id}#${channelId}`, DIRECTIONS.SERVER_TO_CLIENT, socket.sent[0]);
    assert.equal(utf8Decode(plaintext.subarray(8)), '{"type":"saved"}');
    assert.ok(!Buffer.from(socket.sent[0]).includes(Buffer.from('saved')));
  });

  it('rechaza tramas repetidas, fuera de orden, de otra conexión o sin cifrar', () => {
    const store = createSessionStore({ ttlMs: 60000 });
    const session = newSession(store);
    const channelId = toHex(randomBytes(16));
    const channel = openSecureChannel(fakeSocket(), `/?sid=${session.id}&cid=${channelId}`, store);

    const first = clientFrame(session, channelId, 0, 'a');
    channel.decrypt(first, true);
    assert.throws(() => channel.decrypt(first, true), /repetida/);
    assert.throws(() => channel.decrypt(clientFrame(session, channelId, 5, 'b'), true), /fuera de orden/);
    assert.throws(() => channel.decrypt(clientFrame(session, toHex(randomBytes(16)), 1, 'c'), true), /alterado/);
    assert.throws(() => channel.decrypt(Buffer.from('{"type":"join"}'), false), /cifrada/);
  });

  it('cierra la conexión si la sesión no existe o el id de conexión se reutiliza', () => {
    const store = createSessionStore({ ttlMs: 60000 });
    const session = newSession(store);
    const channelId = toHex(randomBytes(16));

    const expired = fakeSocket();
    assert.equal(openSecureChannel(expired, `/?sid=otra&cid=${channelId}`, store), null);
    assert.equal(expired.closed.code, SECURE_CLOSE_CODES.SESSION_EXPIRED);

    assert.ok(openSecureChannel(fakeSocket(), `/?sid=${session.id}&cid=${channelId}`, store));
    const reused = fakeSocket();
    assert.equal(openSecureChannel(reused, `/?sid=${session.id}&cid=${channelId}`, store), null);
    assert.equal(reused.closed.code, SECURE_CLOSE_CODES.INVALID_FRAME);
  });
});
