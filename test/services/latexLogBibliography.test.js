const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SECRET_KEY ||= 'clave-de-prueba';

const { parseLatexLog, getFriendlyMessage } = require('../../src/services/latexService');

test('un "&" sin escapar en el .bib (error en main.bbl) explica que se corrige con \\& en el .bib', () => {
  const log = [
    './main.bbl:229: Misplaced alignment tab character &.',
    'l.229   Interfaces}',
    ''
  ].join('\n');
  const { errors } = parseLatexLog(log, 'main.tex');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, 'main.bbl');
  assert.equal(errors[0].line, 229);
  assert.match(errors[0].friendlyMessage, /\.bib/);
  assert.match(errors[0].friendlyMessage, /\\&/);
});

test('"&" fuera de una tabla en un .tex sugiere usar \\&', () => {
  const friendly = getFriendlyMessage('Misplaced alignment tab character &.', '', 'main.tex');
  assert.match(friendly, /\\&/);
  assert.doesNotMatch(friendly, /\.bib/);
});
