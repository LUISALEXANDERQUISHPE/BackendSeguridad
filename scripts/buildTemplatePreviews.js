/**
 * Compila cada plantilla del sistema y guarda su vista previa (templates/<plantilla>/preview.pdf).
 * Usa el mismo compilador que el editor, así que también verifica que todas las plantillas compilen.
 *
 * Uso:  npm run templates:previews
 * Termina con código 1 si alguna plantilla no compila.
 */
require('dotenv').config({ quiet: true });

const fsp = require('node:fs/promises');
const path = require('node:path');
const { compileProject } = require('../src/services/latexService');
const { TEMPLATES_ROOT, PREVIEW_FILE } = require('../src/constants/templateConstants');
const { createTemplateFileRepository } = require('../src/repositories/templateFileRepository');

const COMPILE_TIMEOUT_MS = 180000;

async function buildPreview(repository, template) {
  const files = await repository.readFiles(template);
  const result = await compileProject(files, template.mainFile, { timeoutMs: COMPILE_TIMEOUT_MS });

  if (!result.success) {
    const reasons = result.errors.map(error => `${error.file}:${error.line ?? '?'} ${error.message}`).join('\n    ');
    return { ok: false, message: `✖ ${template.slug}\n    ${reasons}` };
  }

  await fsp.writeFile(path.join(TEMPLATES_ROOT, template.slug, PREVIEW_FILE), result.pdfBuffer);
  const sizeKb = Math.round(result.pdfBuffer.length / 1024);
  return { ok: true, message: `✔ ${template.slug} (${sizeKb} KB, ${result.compilationTime} ms)` };
}

async function main() {
  const repository = createTemplateFileRepository();
  const templates = await repository.listTemplates();
  let failures = 0;

  // Una a la vez: cada compilación ya usa el motor LaTeX de forma intensiva
  for (const template of templates) {
    const { ok, message } = await buildPreview(repository, template);
    console.log(message);
    if (!ok) failures += 1;
  }

  console.log(`\n${templates.length - failures} de ${templates.length} plantillas compiladas.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
