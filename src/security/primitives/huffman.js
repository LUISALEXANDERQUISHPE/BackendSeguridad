/**
 * Compresión Huffman (canónica) implementada a mano, sobre bytes.
 *
 * Formato del resultado:
 *   [0]      modo: 0 = guardado sin comprimir, 1 = Huffman
 *   [1..4]   longitud original (uint32 big-endian)
 *   modo 1:  [5..6] cantidad de símbolos N (uint16), N pares (símbolo, longitud de código),
 *            y después el flujo de bits (primero el bit más significativo).
 *
 * Se usan códigos canónicos: basta guardar la longitud del código de cada símbolo para
 * reconstruir el árbol, no el árbol completo. Si comprimir no reduce el tamaño (datos ya
 * aleatorios), se guardan los bytes tal cual para no crecer más de 5 bytes.
 */

const MODE_STORED = 0;
const MODE_HUFFMAN = 1;
const HEADER_SIZE = 5;
const MAX_INPUT_SIZE = 0xffffffff;

function writeUint32(out, offset, value) {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function countFrequencies(input) {
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < input.length; i++) frequencies[input[i]]++;
  return frequencies;
}

/**
 * Longitud del código de cada símbolo construyendo el árbol de Huffman:
 * se unen siempre los dos grupos de menor frecuencia y cada unión agrega un bit
 * a todos los símbolos del grupo.
 */
function buildCodeLengths(frequencies) {
  const lengths = new Array(256).fill(0);
  let groups = [];
  for (let symbol = 0; symbol < 256; symbol++) {
    if (frequencies[symbol] > 0) groups.push({ weight: frequencies[symbol], symbols: [symbol] });
  }

  if (groups.length === 1) {
    lengths[groups[0].symbols[0]] = 1;
    return lengths;
  }

  while (groups.length > 1) {
    groups.sort((a, b) => a.weight - b.weight);
    const [first, second] = groups;
    for (const symbol of first.symbols) lengths[symbol]++;
    for (const symbol of second.symbols) lengths[symbol]++;
    groups = [{ weight: first.weight + second.weight, symbols: first.symbols.concat(second.symbols) }, ...groups.slice(2)];
  }
  return lengths;
}

/** Símbolos ordenados por (longitud, símbolo): el orden que define los códigos canónicos. */
function canonicalOrder(lengths) {
  const symbols = [];
  for (let symbol = 0; symbol < 256; symbol++) if (lengths[symbol] > 0) symbols.push(symbol);
  return symbols.sort((a, b) => lengths[a] - lengths[b] || a - b);
}

/** Bits del código canónico de cada símbolo (arreglo de 0/1 por símbolo). */
function buildCanonicalCodes(lengths) {
  const codes = new Array(256).fill(null);
  let code = 0;
  let previousLength = 0;
  for (const symbol of canonicalOrder(lengths)) {
    const length = lengths[symbol];
    code *= 2 ** (length - previousLength);
    previousLength = length;

    const bits = new Uint8Array(length);
    let value = code;
    for (let i = length - 1; i >= 0; i--) {
      bits[i] = value % 2;
      value = Math.floor(value / 2);
    }
    codes[symbol] = bits;
    code++;
  }
  return codes;
}

function storeUncompressed(input) {
  const output = new Uint8Array(HEADER_SIZE + input.length);
  output[0] = MODE_STORED;
  writeUint32(output, 1, input.length);
  output.set(input, HEADER_SIZE);
  return output;
}

/**
 * Comprime bytes con Huffman.
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
function huffmanCompress(input) {
  if (input.length > MAX_INPUT_SIZE) throw new Error('Huffman: entrada demasiado grande');
  if (input.length === 0) return storeUncompressed(input);

  const frequencies = countFrequencies(input);
  const lengths = buildCodeLengths(frequencies);
  const codes = buildCanonicalCodes(lengths);
  const symbols = canonicalOrder(lengths);

  let totalBits = 0;
  for (const symbol of symbols) totalBits += frequencies[symbol] * lengths[symbol];
  const tableSize = 2 + symbols.length * 2;
  const compressedSize = HEADER_SIZE + tableSize + Math.ceil(totalBits / 8);

  if (compressedSize >= HEADER_SIZE + input.length) return storeUncompressed(input);

  const output = new Uint8Array(compressedSize);
  output[0] = MODE_HUFFMAN;
  writeUint32(output, 1, input.length);
  output[5] = (symbols.length >>> 8) & 0xff;
  output[6] = symbols.length & 0xff;
  let offset = 7;
  for (const symbol of symbols) {
    output[offset++] = symbol;
    output[offset++] = lengths[symbol];
  }

  let current = 0;
  let filled = 0;
  for (let i = 0; i < input.length; i++) {
    const bits = codes[input[i]];
    for (let b = 0; b < bits.length; b++) {
      current = (current << 1) | bits[b];
      if (++filled === 8) {
        output[offset++] = current;
        current = 0;
        filled = 0;
      }
    }
  }
  if (filled > 0) output[offset] = current << (8 - filled);

  return output;
}

/**
 * Descomprime lo producido por huffmanCompress.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function huffmanDecompress(data) {
  if (data.length < HEADER_SIZE) throw new Error('Huffman: datos incompletos');
  const mode = data[0];
  const originalLength = readUint32(data, 1);

  if (mode === MODE_STORED) {
    if (data.length !== HEADER_SIZE + originalLength) throw new Error('Huffman: longitud inválida');
    return data.slice(HEADER_SIZE);
  }
  if (mode !== MODE_HUFFMAN) throw new Error('Huffman: formato desconocido');

  const symbolCount = (data[5] << 8) | data[6];
  if (symbolCount < 1 || symbolCount > 256 || data.length < 7 + symbolCount * 2) {
    throw new Error('Huffman: tabla de códigos inválida');
  }

  const lengths = new Array(256).fill(0);
  let maxLength = 0;
  let offset = 7;
  for (let i = 0; i < symbolCount; i++) {
    const symbol = data[offset++];
    const length = data[offset++];
    if (length === 0 || lengths[symbol] !== 0) throw new Error('Huffman: tabla de códigos inválida');
    lengths[symbol] = length;
    maxLength = Math.max(maxLength, length);
  }

  // Decodificación canónica: cuántos códigos hay de cada longitud y en qué orden
  const countPerLength = new Array(maxLength + 1).fill(0);
  for (let symbol = 0; symbol < 256; symbol++) if (lengths[symbol]) countPerLength[lengths[symbol]]++;
  const sortedSymbols = canonicalOrder(lengths);

  const output = new Uint8Array(originalLength);
  let produced = 0;
  let bytePosition = offset;
  let bitPosition = 0;

  while (produced < originalLength) {
    let code = 0;
    let first = 0;
    let index = 0;
    let found = false;

    for (let length = 1; length <= maxLength; length++) {
      if (bytePosition >= data.length) throw new Error('Huffman: datos comprimidos incompletos');
      const bit = (data[bytePosition] >>> (7 - bitPosition)) & 1;
      if (++bitPosition === 8) {
        bitPosition = 0;
        bytePosition++;
      }

      code += bit;
      const count = countPerLength[length];
      if (code - first < count) {
        output[produced++] = sortedSymbols[index + code - first];
        found = true;
        break;
      }
      index += count;
      first = (first + count) * 2;
      code *= 2;
    }

    if (!found) throw new Error('Huffman: código inválido en los datos');
  }

  return output;
}

module.exports = { huffmanCompress, huffmanDecompress };
