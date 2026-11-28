const { randomUUID } = require('crypto');
const { SENSITIVE_TABLES, PROJECT_KEY_COLUMN, sensitiveColumnsOf } = require('./sensitiveColumns');
const { isEncryptedField } = require('../storage/dataProtection');

/**
 * Cliente de Supabase con cifrado transparente de las columnas sensibles:
 *   - insert/update/upsert: cifra (Huffman + AES con la llave del proyecto) antes de enviar,
 *   - cualquier lectura: descifra lo que venga cifrado y quita la columna de la llave del proyecto.
 *
 * Así el resto del backend (controladores, servicios, repositorios) trabaja siempre con texto
 * en claro y no hay forma de olvidar cifrar una escritura.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} rawClient
 * @param {() => {
 *   dataProtection: { protectField: Function, revealField: Function },
 *   projectResolver: { resolveProjectId: Function },
 *   projectKeyService: { createKeyRecord: Function }
 * }} getDeps Se piden al usarse (evita dependencias circulares al cargar los módulos)
 * @param {Record<string, unknown>} [extras] Propiedades adicionales a exponer (ej. createAuthClient)
 */
function createSecureDatabaseClient(rawClient, getDeps, extras = {}) {
  const WRITE_METHODS = new Set(['insert', 'update', 'upsert']);

  async function revealDeep(value) {
    if (Array.isArray(value)) return Promise.all(value.map(revealDeep));
    if (!value || typeof value !== 'object') return value;

    const { dataProtection } = getDeps();
    const result = {};
    for (const [column, item] of Object.entries(value)) {
      if (column === PROJECT_KEY_COLUMN) continue;
      if (isEncryptedField(item)) result[column] = await dataProtection.revealField(item, column);
      else result[column] = item && typeof item === 'object' ? await revealDeep(item) : item;
    }
    return result;
  }

  async function revealResult(result) {
    if (result && !result.error && result.data) {
      result.data = await revealDeep(result.data);
    }
    return result;
  }

  function hasSensitiveValues(table, values) {
    const columns = sensitiveColumnsOf(table);
    const rows = Array.isArray(values) ? values : [values];
    return rows.some((row) => row && columns.some((column) => row[column] !== null && row[column] !== undefined));
  }

  function needsProtection(table, method, values) {
    if (!SENSITIVE_TABLES[table]) return false;
    // Todo proyecto nuevo nace con su llave, aunque todavía no tenga datos cifrados
    if (table === 'proyectos' && method !== 'update') return true;
    return hasSensitiveValues(table, values);
  }

  async function protectRow(table, method, row, filters) {
    const { dataProtection, projectResolver, projectKeyService } = getDeps();
    const protectedRow = { ...row };
    let projectId = null;

    if (table === 'proyectos' && method !== 'update') {
      protectedRow.id = protectedRow.id || randomUUID();
      projectId = protectedRow.id;
      if (!protectedRow[PROJECT_KEY_COLUMN]) {
        protectedRow[PROJECT_KEY_COLUMN] = projectKeyService.createKeyRecord(projectId).wrapped;
      }
    }

    for (const column of sensitiveColumnsOf(table)) {
      if (protectedRow[column] === null || protectedRow[column] === undefined) continue;
      projectId ??= await projectResolver.resolveProjectId(table, protectedRow, filters);
      protectedRow[column] = await dataProtection.protectField(projectId, column, protectedRow[column]);
    }
    return protectedRow;
  }

  async function protectValues(table, method, values, filters) {
    if (Array.isArray(values)) return Promise.all(values.map((row) => protectRow(table, method, row, filters)));
    return protectRow(table, method, values, filters);
  }

  /**
   * Escritura con datos a cifrar. Cifrar es asíncrono (puede consultar la llave), así que se
   * registran los métodos encadenados (.eq, .select, .single...) y se ejecutan al esperar el
   * resultado. Los filtros .eq() también sirven para saber el proyecto en un update.
   */
  function deferredWrite(baseBuilder, table, method, values, options) {
    const calls = [];
    const filters = {};

    async function execute() {
      const protectedValues = await protectValues(table, method, values, filters);
      let query = baseBuilder[method](protectedValues, options);
      for (const [name, args] of calls) query = query[name](...args);
      return revealResult(await query);
    }

    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (onFulfilled, onRejected) => execute().then(onFulfilled, onRejected);
        return (...args) => {
          if (prop === 'eq') filters[args[0]] = args[1];
          if (prop === 'match' && args[0]) Object.assign(filters, args[0]);
          calls.push([prop, args]);
          return proxy;
        };
      }
    });
    return proxy;
  }

  function wrapQuery(builder, table) {
    return new Proxy(builder, {
      get(target, prop) {
        if (prop === 'then') {
          return (onFulfilled, onRejected) => target.then(revealResult).then(onFulfilled, onRejected);
        }
        if (WRITE_METHODS.has(prop)) {
          return (values, options) => (needsProtection(table, prop, values)
            ? deferredWrite(target, table, prop, values, options)
            : wrapQuery(target[prop](values, options), table));
        }
        const member = Reflect.get(target, prop, target);
        if (typeof member !== 'function') return member;
        return (...args) => {
          const output = member.apply(target, args);
          return output && typeof output.then === 'function' ? wrapQuery(output, table) : output;
        };
      }
    });
  }

  return new Proxy(rawClient, {
    get(target, prop) {
      if (prop === 'from') return (table) => wrapQuery(target.from(table), table);
      if (Object.prototype.hasOwnProperty.call(extras, prop)) return extras[prop];
      const member = Reflect.get(target, prop, target);
      return typeof member === 'function' ? member.bind(target) : member;
    }
  });
}

module.exports = { createSecureDatabaseClient };
