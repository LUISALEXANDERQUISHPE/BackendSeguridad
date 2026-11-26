const { randomUUID } = require('crypto');

/**
 * Cliente de Supabase falso, en memoria, con la parte de la API que usa el backend
 * (from().select/insert/update/delete/eq/is/in/order/limit/range/single/maybeSingle).
 * Guarda los valores tal como llegan, así las pruebas ven exactamente lo que se escribiría.
 */
function createFakeSupabase(initialTables = {}) {
  const tables = new Map(Object.entries(initialTables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const writes = [];

  const rowsOf = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };

  function pick(row, columns) {
    if (columns === '*') return { ...row };
    const result = {};
    for (const column of columns.split(',').map((name) => name.trim()).filter(Boolean)) result[column] = row[column];
    return result;
  }

  function from(table) {
    const state = { op: 'select', values: null, filters: [], columns: '*', returning: false, single: false, maybe: false };

    function execute() {
      const rows = rowsOf(table);
      const matches = (row) => state.filters.every((filter) => filter(row));
      let affected;

      if (state.op === 'insert') {
        const list = Array.isArray(state.values) ? state.values : [state.values];
        affected = list.map((values) => ({ id: values.id ?? randomUUID(), ...values }));
        rows.push(...affected);
        writes.push({ table, op: 'insert', values: list });
      } else if (state.op === 'update') {
        affected = rows.filter(matches);
        for (const row of affected) Object.assign(row, state.values);
        writes.push({ table, op: 'update', values: state.values });
      } else if (state.op === 'delete') {
        affected = rows.filter(matches);
        tables.set(table, rows.filter((row) => !matches(row)));
      } else {
        affected = rows.filter(matches);
      }

      if (state.op !== 'select' && !state.returning) return { data: null, error: null };
      let data = affected.map((row) => pick(row, state.columns));
      if (state.single || state.maybe) {
        if (data.length === 0) return state.maybe ? { data: null, error: null } : { data: null, error: { message: 'Sin filas' } };
        data = data[0];
      }
      return { data, error: null };
    }

    const builder = {
      select(columns = '*') {
        state.columns = columns;
        if (state.op !== 'select') state.returning = true;
        return builder;
      },
      insert(values) { state.op = 'insert'; state.values = values; return builder; },
      upsert(values) { state.op = 'insert'; state.values = values; return builder; },
      update(values) { state.op = 'update'; state.values = values; return builder; },
      delete() { state.op = 'delete'; return builder; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return builder; },
      is(column, value) { state.filters.push((row) => (row[column] ?? null) === value); return builder; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return builder; },
      order() { return builder; },
      limit() { return builder; },
      range() { return builder; },
      single() { state.single = true; return builder; },
      maybeSingle() { state.maybe = true; return builder; },
      then(onFulfilled, onRejected) {
        return Promise.resolve().then(execute).then(onFulfilled, onRejected);
      }
    };
    return builder;
  }

  return { from, tables, writes, storage: {}, auth: {} };
}

module.exports = { createFakeSupabase };
