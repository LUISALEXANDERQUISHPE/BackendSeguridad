const test = require('node:test');
const assert = require('node:assert/strict');

// El módulo crea al importarse el cliente real de Supabase (que exige estas variables).
// Los tests usan su propio doble de la base de datos, así que basta con valores ficticios.
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SECRET_KEY ||= 'clave-de-prueba';

const { createVersionRepository } = require('../../src/repositories/versionRepository');

/**
 * Doble mínimo de una tabla de Supabase: aplica .eq(), .order(), .limit() y, como PostgREST,
 * maybeSingle() falla con PGRST116 si quedan dos o más filas.
 */
function fakeDb(rows) {
  return {
    from() {
      let result = [...rows];
      const query = {
        select: () => query,
        eq(column, value) {
          result = result.filter((row) => row[column] === value);
          return query;
        },
        order(column, { ascending }) {
          // Orden estable: los .order() posteriores desempatan a los anteriores
          const previous = result.map((row, index) => ({ row, index }));
          result = previous
            .sort((a, b) => {
              if (a.row[column] === b.row[column]) return a.index - b.index;
              return (a.row[column] > b.row[column] ? 1 : -1) * (ascending ? 1 : -1);
            })
            .map(({ row }) => row);
          query.orders = [...(query.orders || []), column];
          return query;
        },
        limit(count) {
          result = result.slice(0, count);
          return query;
        },
        maybeSingle() {
          if (result.length > 1) {
            return Promise.resolve({
              data: null,
              error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
            });
          }
          return Promise.resolve({ data: result[0] ?? null, error: null });
        }
      };
      return query;
    }
  };
}

const FILE = 'archivo-1';
const DUPLICATED = [
  { id: 'a', archivo_id: FILE, numero_version: 1, creado_en: '2026-10-20T21:16:00Z', contenido_snapshot: 'v1' },
  { id: 'b', archivo_id: FILE, numero_version: 2, creado_en: '2026-10-20T21:16:48Z', contenido_snapshot: 'v2 (primera)' },
  { id: 'c', archivo_id: FILE, numero_version: 2, creado_en: '2026-10-20T21:16:49Z', contenido_snapshot: 'v2 (segunda)' }
];

test('una base sin el arreglo reproduce el error PGRST116 con dos versiones del mismo número', async () => {
  const query = fakeDb(DUPLICATED).from().select().eq('archivo_id', FILE).eq('numero_version', 2);
  const { error } = await query.maybeSingle();
  assert.equal(error.code, 'PGRST116');
});

test('findVersion no falla con números repetidos: devuelve la versión más reciente', async () => {
  const repository = createVersionRepository(fakeDb(DUPLICATED));
  const version = await repository.findVersion(FILE, 2);
  assert.equal(version.id, 'c');
  assert.equal(version.contenido_snapshot, 'v2 (segunda)');
});

test('findVersion sigue funcionando normal cuando no hay duplicados', async () => {
  const repository = createVersionRepository(fakeDb(DUPLICATED));
  assert.equal((await repository.findVersion(FILE, 1)).id, 'a');
  assert.equal(await repository.findVersion(FILE, 99), null);
});

test('findLatestVersion desempata por fecha si la última versión estuviera repetida', async () => {
  const repository = createVersionRepository(fakeDb(DUPLICATED));
  assert.equal((await repository.findLatestVersion(FILE)).id, 'c');
});
