const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeLineDiff, countLineChanges, splitLines } = require('../../src/utils/textDiff');

describe('splitLines', () => {
  it('acepta saltos de línea de Windows y Unix sin crear una línea vacía al final', () => {
    assert.deepEqual(splitLines('a\r\nb\n'), ['a', 'b']);
  });

  it('devuelve una lista vacía para texto vacío', () => {
    assert.deepEqual(splitLines(''), []);
  });
});

describe('computeLineDiff', () => {
  it('marca líneas iguales, eliminadas y agregadas con su número en cada versión', () => {
    const { lines, stats } = computeLineDiff('a\nb\nc', 'a\nx\nc\nd');

    assert.deepEqual(lines, [
      { type: 'equal', oldNumber: 1, newNumber: 1, text: 'a' },
      { type: 'removed', oldNumber: 2, newNumber: null, text: 'b' },
      { type: 'added', oldNumber: null, newNumber: 2, text: 'x' },
      { type: 'equal', oldNumber: 3, newNumber: 3, text: 'c' },
      { type: 'added', oldNumber: null, newNumber: 4, text: 'd' }
    ]);
    assert.deepEqual(stats, { added: 2, removed: 1, unchanged: 2 });
  });

  it('considera iguales textos que solo difieren en el tipo de salto de línea', () => {
    assert.deepEqual(computeLineDiff('a\r\nb', 'a\nb\n').stats, { added: 0, removed: 0, unchanged: 2 });
  });

  it('trata todo como agregado si la versión anterior está vacía', () => {
    assert.deepEqual(countLineChanges('', 'uno\ndos'), { added: 2, removed: 0 });
  });
});
