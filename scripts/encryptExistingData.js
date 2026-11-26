/**
 * Cifra los datos que ya existían antes del cifrado (Huffman + AES-256-CTR con la llave de cada proyecto):
 *   1. crea la llave de cada proyecto que no la tenga (protegida con CRYPTO_MASTER_KEY),
 *   2. cifra las columnas con contenido (ver src/security/database/sensitiveColumns.js),
 *   3. cifra los archivos de Supabase Storage (proyectos/<id>/...),
 * Después de cifrar cada dato lo vuelve a leer y descifrar para comprobar que no se perdió nada.
 *
 * Es seguro ejecutarlo varias veces: lo que ya está cifrado se salta.
 * Conviene ejecutarlo con el backend detenido, para que nadie escriba mientras tanto.
 *
 * Uso (desde BackendSeguridad):
 *   node scripts/encryptExistingData.js --dry-run         solo cuenta lo que falta cifrar
 *   node scripts/encryptExistingData.js                   cifra y verifica
 */
require('dotenv').config({ quiet: true });
const supabase = require('../src/config/supabase');
const storageService = require('../src/services/storageService');
const { getSecurity } = require('../src/security');
const { SENSITIVE_TABLES } = require('../src/security/database/sensitiveColumns');
const { isEncryptedField, isEncryptedBytes } = require('../src/security/storage/dataProtection');

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 500;
const raw = supabase.raw;

const summary = [];
function report(area, counts) {
  summary.push({ area, ...counts });
  console.log(`  ${area}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await raw.from(table).select(columns).order('id').range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function assertSchemaReady() {
  const { error } = await raw.from('proyectos').select('id, llave_cifrada').limit(1);
  if (error) {
    console.error('\nFalta la columna proyectos.llave_cifrada. Ejecuta primero supabase/007_cifrado.sql en el editor SQL de Supabase.\n');
    console.error(error.message);
    return false;
  }
  return true;
}

async function ensureProjectKeys(projects) {
  const { projectKeyService } = getSecurity();
  let created = 0;
  for (const project of projects) {
    if (project.llave_cifrada) continue;
    created++;
    if (!DRY_RUN) await projectKeyService.getProjectKey(project.id);
  }
  report('llaves de proyecto', { proyectos: projects.length, [DRY_RUN ? 'por crear' : 'creadas']: created });
}

function projectOf(table, row, nodeProject) {
  const rule = SENSITIVE_TABLES[table].project;
  if (rule.self) return row.id;
  if (rule.column) return row[rule.column];
  return nodeProject.get(row[rule.file]) ?? null;
}

async function encryptTable(table, nodeProject) {
  const { columns, project: rule } = SENSITIVE_TABLES[table];
  const linkColumn = rule.column || rule.file;
  const rows = await fetchAll(table, ['id', linkColumn, ...columns].filter(Boolean).join(', '));
  const { dataProtection } = getSecurity();
  const counts = { filas: rows.length, [DRY_RUN ? 'por cifrar' : 'cifradas']: 0, verificadas: 0, huerfanas: 0, errores: 0 };

  for (const row of rows) {
    const pending = columns.filter((column) => typeof row[column] === 'string' && !isEncryptedField(row[column]));
    if (pending.length === 0) continue;

    const projectId = projectOf(table, row, nodeProject);
    if (!projectId) {
      counts.huerfanas++;
      continue;
    }
    counts[DRY_RUN ? 'por cifrar' : 'cifradas']++;
    if (DRY_RUN) continue;

    try {
      const changes = {};
      for (const column of pending) changes[column] = await dataProtection.protectField(projectId, column, row[column]);
      const { error } = await raw.from(table).update(changes).eq('id', row.id);
      if (error) throw error;

      // Verificación: leer por el cliente normal (que descifra) y comparar con el original
      const { data, error: readError } = await supabase.from(table).select(pending.join(', ')).eq('id', row.id).single();
      if (readError) throw readError;
      if (pending.some((column) => data[column] !== row[column])) throw new Error('el contenido descifrado no coincide');
      counts.verificadas++;
    } catch (error) {
      counts.errores++;
      console.error(`    ✖ ${table} ${row.id}: ${error.message}`);
    }
  }
  report(table, counts);
}

async function listFilesRecursively(prefix) {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await raw.storage.from(storageService.BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const entry of data) {
      const entryPath = `${prefix}/${entry.name}`;
      // Las carpetas no tienen id
      if (entry.id === null) files.push(...await listFilesRecursively(entryPath));
      else files.push(entryPath);
    }
    if (data.length < 1000) return files;
  }
}

async function encryptStorage(projects) {
  const counts = { archivos: 0, [DRY_RUN ? 'por cifrar' : 'cifrados']: 0, verificados: 0, errores: 0 };
  for (const project of projects) {
    const files = await listFilesRecursively(storageService.getProjectFolder(project.id));
    counts.archivos += files.length;
    for (const filePath of files) {
      try {
        const stored = await storageService.downloadRaw(filePath);
        if (!stored || isEncryptedBytes(stored)) continue;
        counts[DRY_RUN ? 'por cifrar' : 'cifrados']++;
        if (DRY_RUN) continue;

        await storageService.uploadBinary(filePath, stored);
        const restored = await storageService.downloadFile(filePath);
        if (!restored || !restored.equals(stored)) throw new Error('el archivo descifrado no coincide');
        counts.verificados++;
      } catch (error) {
        counts.errores++;
        console.error(`    ✖ Storage ${filePath}: ${error.message}`);
      }
    }
  }
  report('Supabase Storage', counts);
}

async function main() {
  console.log(`\nCifrado de datos existentes${DRY_RUN ? ' (simulación: no se modifica nada)' : ''}\n`);
  if (!(await assertSchemaReady())) {
    process.exitCode = 1;
    return;
  }

  const projects = await fetchAll('proyectos', 'id, llave_cifrada');
  await ensureProjectKeys(projects);

  const nodes = await fetchAll('nodos', 'id, proyecto_id');
  const nodeProject = new Map(nodes.map((node) => [node.id, node.proyecto_id]));

  for (const table of Object.keys(SENSITIVE_TABLES)) await encryptTable(table, nodeProject);
  await encryptStorage(projects);

  const errors = summary.reduce((total, item) => total + (item.errores || 0), 0);
  console.log(errors ? `\n${errors} error(es). Revisa los mensajes anteriores.\n` : '\nListo: todo verificado sin errores.\n');
  process.exitCode = errors ? 1 : 0;
}

main().catch((error) => {
  console.error('\nLa migración se detuvo:', error.message);
  process.exitCode = 1;
});
