const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sha256 } = require('../../src/security/primitives/sha256');
const { hmacSha256 } = require('../../src/security/primitives/hmac');
const { hkdf } = require('../../src/security/primitives/hkdf');
const { chacha20 } = require('../../src/security/primitives/chacha20');
const { aes256Ctr, aes256EncryptBlock } = require('../../src/security/primitives/aes256ctr');
const { huffmanCompress, huffmanDecompress } = require('../../src/security/primitives/huffman');
const { createGroup, generateKeyPair, computeSharedSecret } = require('../../src/security/primitives/diffieHellman');
const { randomBytes } = require('../../src/security/primitives/random');
const { fromHex, toHex, utf8Encode, utf8Decode } = require('../../src/security/primitives/bytes');

// Vectores oficiales: si alguno falla, el algoritmo no es compatible con el estándar.

describe('SHA-256 / HMAC / HKDF', () => {
  it('SHA-256 de "abc" (FIPS 180-4)', () => {
    assert.equal(toHex(sha256(utf8Encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('SHA-256 de un mensaje vacío', () => {
    assert.equal(toHex(sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('HMAC-SHA256 (RFC 4231, caso 2)', () => {
    const tag = hmacSha256(utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?'));
    assert.equal(toHex(tag), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('HKDF-SHA256 (RFC 5869, caso 1)', () => {
    const okm = hkdf(new Uint8Array(22).fill(0x0b), fromHex('000102030405060708090a0b0c'), fromHex('f0f1f2f3f4f5f6f7f8f9'), 42);
    assert.equal(toHex(okm), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });
});

describe('ChaCha20', () => {
  it('cifra el vector de RFC 8439 (sección 2.4.2)', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const nonce = fromHex('000000000000004a00000000');
    const plaintext = utf8Encode("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
    const ciphertext = chacha20(key, nonce, plaintext, 1);
    assert.equal(toHex(ciphertext).slice(0, 64), '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0b');
    assert.equal(toHex(ciphertext).slice(-36), '5af90bbf74a35be6b40b8eedf2785e42874d');
  });

  it('descifrar devuelve exactamente el mensaje, incluso largo', () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const message = randomBytes(3 * 1024 * 1024 + 7);
    assert.deepEqual(chacha20(key, nonce, chacha20(key, nonce, message)), message);
  });
});

describe('AES-256-CTR', () => {
  it('cifra el bloque de FIPS 197 (apéndice C.3)', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const block = aes256EncryptBlock(key, fromHex('00112233445566778899aabbccddeeff'));
    assert.equal(toHex(block), '8ea2b7ca516745bfeafc49904b496089');
  });

  it('cifra el vector CTR-AES256 de NIST SP 800-38A (F.5.5)', () => {
    const key = fromHex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4');
    const iv = fromHex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
    const plaintext = fromHex(
      '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710'
    );
    assert.equal(
      toHex(aes256Ctr(key, iv, plaintext)),
      '601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c5' +
      '2b0930daa23de94ce87017ba2d84988ddfc9c58db67aada613c2dd08457941a6'
    );
  });

  it('descifra mensajes de longitud que no es múltiplo de 16', () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    for (const length of [0, 1, 15, 17, 100003]) {
      const message = randomBytes(length);
      assert.deepEqual(aes256Ctr(key, iv, aes256Ctr(key, iv, message)), message);
    }
  });
});

describe('Huffman', () => {
  const roundtrip = (bytes) => huffmanDecompress(huffmanCompress(bytes));

  it('recupera textos vacíos, de un solo símbolo y con Unicode', () => {
    for (const text of ['', 'a', 'aaaaaaaaaa', 'Ñandú 😀 \\section{Introducción}']) {
      assert.equal(utf8Decode(roundtrip(utf8Encode(text))), text);
    }
  });

  it('reduce el tamaño de un documento LaTeX largo y lo recupera completo', () => {
    const text = '\\documentclass{article}\n\\begin{document}\nHola mundo, ecuación $x^2$.\n'.repeat(40000);
    const bytes = utf8Encode(text);
    const compressed = huffmanCompress(bytes);
    assert.ok(compressed.length < bytes.length * 0.75, `comprimido ${compressed.length} de ${bytes.length}`);
    assert.equal(utf8Decode(huffmanDecompress(compressed)), text);
  });

  it('datos aleatorios (no comprimibles) no crecen más de 5 bytes', () => {
    const bytes = randomBytes(50000);
    const compressed = huffmanCompress(bytes);
    assert.ok(compressed.length <= bytes.length + 5);
    assert.deepEqual(huffmanDecompress(compressed), bytes);
  });

  it('rechaza datos comprimidos truncados', () => {
    const compressed = huffmanCompress(utf8Encode('texto de prueba '.repeat(100)));
    assert.throws(() => huffmanDecompress(compressed.slice(0, compressed.length - 10)));
  });
});

describe('Diffie-Hellman', () => {
  const group = createGroup(process.env.DH_PRIME_HEX || require('crypto').getDiffieHellman('modp14').getPrime('hex'), '2');

  it('ambas partes calculan el mismo secreto sin enviarlo', () => {
    const client = generateKeyPair(group);
    const server = generateKeyPair(group);
    const clientSecret = computeSharedSecret(group, client.privateKey, server.publicKey);
    const serverSecret = computeSharedSecret(group, server.privateKey, client.publicKey);
    assert.deepEqual(clientSecret, serverSecret);
    assert.equal(clientSecret.length, 256);
  });

  it('rechaza valores públicos triviales', () => {
    const { privateKey } = generateKeyPair(group);
    assert.throws(() => computeSharedSecret(group, privateKey, Uint8Array.of(1)));
    assert.throws(() => computeSharedSecret(group, privateKey, new Uint8Array(256)));
  });
});
