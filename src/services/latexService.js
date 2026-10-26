const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const config = require('../config');

// Directorio base de almacenamiento para PDFs compilados
const COMPILATIONS_DIR = path.join(config.storagePath, 'compilations');

/**
 * Inicializa el directorio de compilaciones si no existe
 */
function ensureStorageDirectories() {
  if (!fs.existsSync(COMPILATIONS_DIR)) {
    fs.mkdirSync(COMPILATIONS_DIR, { recursive: true });
  }
}

// Ejecutar inicialización de directorios
ensureStorageDirectories();

/**
 * Genera un mensaje explicativo y amigable para errores comunes de LaTeX,
 * especialmente problemas estructurales en tablas (\noalign, \hline, \\, etc.).
 *
 * @param {string} message Mensaje de error principal
 * @param {string} context Fragmento de contexto del log
 * @returns {string|null} Mensaje amigable o null
 */
function getFriendlyMessage(message, context = '') {
  const combined = `${message} ${context}`.toLowerCase();

  // 1. Error: Misplaced \noalign (típico de \hline mal ubicado, falta de \\ o fuera de tabular)
  if (/misplaced\s*\\noalign/.test(combined) || /\\noalign/.test(combined)) {
    return 'Probablemente existe un problema con \\hline: verifica si falta un salto de fila (\\\\) antes de \\hline, si hay un \\hline duplicado, o si \\hline está fuera del entorno de tabla (tabular/tabularx).';
  }

  // 2. Error de discrepancia en entornos (ej. begin{tabular} cerrado con end{tabularx} o viceversa)
  const envMismatch = message.match(/\\begin\{([^}]+)\}.*ended by\s*\\end\{([^}]+)\}/i);
  if (envMismatch) {
    return `Discrepancia en el cierre de entornos: el entorno '\\begin{${envMismatch[1]}}' no puede cerrarse con '\\end{${envMismatch[2]}}'. Asegúrate de que las etiquetas de apertura y cierre coincidan exactamente.`;
  }
  if (/ended by\s*\\end/i.test(combined)) {
    return 'Discrepancia en el cierre de entornos: una etiqueta \\begin{...} se intentó cerrar con un \\end{...} diferente. Revisa que las etiquetas de apertura y cierre de la tabla o bloque coincidan.';
  }

  // 3. Error: Extra alignment tab (más columnas que las declaradas o falta \\)
  if (/extra alignment tab has been changed to \\cr/i.test(combined) || /extra alignment tab/i.test(combined)) {
    return 'Hay más separadores de columna (&) en esta fila de los definidos en la estructura de la tabla, o falta un salto de fila (\\\\) al final de la fila anterior.';
  }

  // 4. Error: Undefined control sequence (comando no reconocido)
  if (/undefined control sequence/i.test(combined)) {
    return 'Comando LaTeX desconocido o no definido. Verifica que esté bien escrito o que hayas incluido el paquete correspondiente con \\usepackage{...} en el preámbulo.';
  }

  // 5. Error: File ended while scanning (llaves o argumentos sin cerrar)
  if (/file ended while scanning/i.test(combined) || /forgotten a [`']\}/i.test(combined) || /runaway argument/i.test(combined)) {
    return 'El archivo terminó inesperadamente o hay un argumento sin cerrar. Probablemente olvidaste cerrar una llave "}" o un parámetro obligatorio.';
  }

  // 6. Error: Missing \begin{document}
  if (/missing \\begin\{document\}/i.test(combined)) {
    return 'Falta la instrucción \\begin{document} o hay texto fuera del entorno del documento.';
  }

  // 6b. Error: babel (ej. spanish) activa caracteres como < > " que rompen TikZ/pgfplots (\draw[->], etc.)
  if (/\\language@active@arg/i.test(combined) || /\\es@(?:active|shorthand)/i.test(combined)) {
    return 'Babel (idioma español) cambia el significado de caracteres como > < " y rompe comandos de TikZ/pgfplots como \\draw[->]. Agrega \\usetikzlibrary{babel} después de cargar tikz, o usa \\usepackage[spanish,es-noshorthands]{babel}.';
  }

  // 7. Error: File not found (paquete faltante)
  const fileNotFound = message.match(/file [`']([^']+\.(?:sty|cls))['`] not found/i);
  if (fileNotFound) {
    return `El paquete o clase '${fileNotFound[1]}' no se encuentra instalado en el servidor ni existe en el proyecto.`;
  }

  // 8. Error: archivo del proyecto no encontrado (\includegraphics, \input, \include, \bibliography...)
  const projectFileNotFound = message.match(/file [`']([^'`]+)['`] not found/i);
  if (projectFileNotFound) {
    return `No se encontró el archivo '${projectFileNotFound[1]}'. Verifica que exista en el proyecto y que la ruta sea relativa a la raíz del proyecto (ej. imagenes/figura.png o capitulos/intro), respetando mayúsculas y minúsculas.`;
  }

  return null;
}

// Formato de -file-line-error: "./capitulos/intro.tex:12: mensaje" (cualquier extensión: .tex, .sty, .bbl...)
const FILE_LINE_ERROR_PATTERN = /^((?:[A-Za-z]:)?[^:\n]+\.[A-Za-z0-9]+):(\d+):\s*(.+)$/;

/**
 * Convierte la ruta que reporta TeX en una ruta relativa a la raíz del proyecto
 * (ej. "./capitulos/intro.tex" -> "capitulos/intro.tex")
 */
function toProjectRelativePath(filePath, rootDir) {
  let value = String(filePath || '').trim().replace(/\\/g, '/');
  if (rootDir && path.isAbsolute(value)) {
    value = path.relative(rootDir, value).replace(/\\/g, '/');
  }
  return value.replace(/^(\.\/)+/, '');
}

/**
 * Analiza el archivo de log y la salida de pdflatex para extraer
 * errores con su número de línea real, archivo, mensajes, tipo de error,
 * fragmento de contexto y mensaje amigable explicativo.
 *
 * @param {string} logContent Contenido del archivo .log o stdout
 * @param {string} defaultFileName Nombre esperado del archivo tex
 * @param {string|null} rootDir Directorio raíz del proyecto, para reportar rutas relativas
 * @returns {{ errors: Array, warnings: Array }}
 */
function parseLatexLog(logContent, defaultFileName = 'document.tex', rootDir = null) {
  const errors = [];
  const warnings = [];

  if (!logContent || typeof logContent !== 'string') {
    return { errors, warnings };
  }

  const lines = logContent.split(/\r?\n/);
  const seenErrors = new Set();
  const seenWarnings = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 1. Detección de errores (-file-line-error o clásico con '!')
    const fileLineMatch = line.match(FILE_LINE_ERROR_PATTERN);
    const classicMatch = !fileLineMatch && line.startsWith('! ') && !line.includes('==> Fatal error')
      ? line.substring(2).trim()
      : null;

    if (fileLineMatch || classicMatch) {
      let filePath = fileLineMatch ? fileLineMatch[1].trim() : defaultFileName;
      let lineNum = fileLineMatch ? parseInt(fileLineMatch[2], 10) : null;
      let message = fileLineMatch ? fileLineMatch[3].trim() : classicMatch;

      // Omitir líneas de resumen general o de parada de emergencia
      if (message.includes('==> Fatal error occurred') || message.includes('Emergency stop')) {
        continue;
      }

      const contextItems = [];

      // Explorar las siguientes líneas para capturar contexto, continuación de mensaje y número de línea
      let j = i + 1;
      while (j < Math.min(i + 15, lines.length)) {
        const nextRaw = lines[j];
        const nextLine = nextRaw.trim();

        // Si encontramos el inicio de otro error o fin fatal, detener exploración de contexto
        if (
          (FILE_LINE_ERROR_PATTERN.test(nextLine) || nextLine.startsWith('! ')) &&
          !nextLine.includes('==> Fatal error')
        ) {
          break;
        }

        // Detectar si la línea anterior del mensaje quedó truncada por el wrap de 79 caracteres de TeX
        if (
          contextItems.length === 0 &&
          nextLine &&
          !nextLine.startsWith('l.') &&
          !nextLine.startsWith('\\') &&
          !nextLine.startsWith('<') &&
          !nextLine.startsWith('See the LaTeX') &&
          !nextLine.startsWith('Type ') &&
          !nextLine.startsWith('...') &&
          message.length > 50 &&
          !message.endsWith('.')
        ) {
          message += ' ' + nextLine;
          j++;
          continue;
        }

        // Capturar número de línea desde l.<num> si no se tenía o como contexto
        const lMatch = nextLine.match(/^l\.(\d+)\s*(.*)$/);
        if (lMatch) {
          if (!lineNum) {
            lineNum = parseInt(lMatch[1], 10);
          }
          contextItems.push(nextLine);
          j++;
          continue;
        }

        // Capturar expansiones de macro y líneas relevantes de contexto
        if (
          nextLine.includes('->') ||
          nextLine.startsWith('<inserted text>') ||
          nextLine.startsWith('<to be read again>') ||
          nextLine.startsWith('<template>') ||
          nextLine.includes('suspect you have forgotten') ||
          nextLine.includes('entered at line')
        ) {
          contextItems.push(nextLine);
        }

        // Si se menciona 'entered at line <num>' o 'on input line <num>', extraer línea si falta
        if (!lineNum) {
          const inputLineMatch = nextLine.match(/(?:entered at line|on input line)\s+(\d+)/i);
          if (inputLineMatch) {
            lineNum = parseInt(inputLineMatch[1], 10);
          }
        }

        j++;
      }

      // Si aún no hay línea, buscar en el mensaje ("on input line <num>")
      if (!lineNum) {
        const msgLineMatch = message.match(/(?:on input line|at lines?)\s+(\d+)/i);
        if (msgLineMatch) {
          lineNum = parseInt(msgLineMatch[1], 10);
        }
      }

      const fileName = toProjectRelativePath(filePath, rootDir);
      const contextText = contextItems.length > 0 ? contextItems.join('\n') : null;
      const friendly = getFriendlyMessage(message, contextText || '');

      const key = `${fileName}:${lineNum}:${message}`;
      if (!seenErrors.has(key)) {
        seenErrors.add(key);
        errors.push({
          file: fileName,
          archivo: fileName,
          line: lineNum,
          linea: lineNum,
          message,
          type: 'error',
          context: contextText,
          friendlyMessage: friendly
        });
      }
      continue;
    }

    // 2. Advertencias de LaTeX o paquetes
    if (line.includes('Warning:')) {
      const warnMatch = line.match(/(?:LaTeX|Package [^:]+) Warning:\s*(.+?)(?:\s+on input line (\d+)\.?)?$/i);
      if (warnMatch) {
        const warnMessage = warnMatch[1].trim();
        const warnLine = warnMatch[2] ? parseInt(warnMatch[2], 10) : null;
        const key = `${warnLine}:${warnMessage}`;

        if (!seenWarnings.has(key)) {
          seenWarnings.add(key);
          warnings.push({
            file: defaultFileName,
            archivo: defaultFileName,
            line: warnLine,
            linea: warnLine,
            message: warnMessage,
            type: 'warning'
          });
        }
        continue;
      }
    }

    // 3. Advertencias de Overfull / Underfull boxes
    const boxMatch = line.match(/(Overfull|Underfull) \\(hbox|vbox) .* at lines? (\d+)/i);
    if (boxMatch) {
      const boxLine = parseInt(boxMatch[3], 10);
      const key = `box:${boxLine}:${line}`;
      if (!seenWarnings.has(key)) {
        seenWarnings.add(key);
        warnings.push({
          file: defaultFileName,
          archivo: defaultFileName,
          line: boxLine,
          linea: boxLine,
          message: line,
          type: 'warning'
        });
      }
    }
  }

  return { errors, warnings };
}

/**
 * Ejecuta un programa (motor LaTeX, bibtex, biber, makeindex) dentro del sandbox,
 * sin shell y con un tiempo máximo.
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, timedOut: boolean }>}
 */
function runTool(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    if (timeoutMs <= 0) {
      resolve({ code: null, stdout, stderr, timedOut: true });
      return;
    }

    const child = spawn(command, args, { cwd, env, windowsHide: true });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch (e) {
        // Proceso ya terminado
      }
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\nError al ejecutar ${command}: ${err.message}`;
      resolve({ code: null, stdout, stderr, timedOut });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Resuelve una ruta relativa del proyecto dentro del sandbox, impidiendo salir de él
 * (rutas absolutas, "..", unidades de Windows, etc.).
 * @returns {string|null} Ruta absoluta segura o null si la ruta no es válida
 */
function resolveInsideSandbox(rootDir, relativePath) {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..' || part.includes(':'))) {
    return null;
  }
  const target = path.resolve(rootDir, ...parts);
  const relative = path.relative(rootDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

/**
 * Escribe todos los archivos del proyecto en el sandbox respetando la estructura de carpetas,
 * para que \input, \include, \includegraphics, \bibliography, \addbibresource, etc.
 * encuentren los archivos con la misma ruta que el usuario ve en el árbol.
 */
async function writeProjectFiles(rootDir, files) {
  for (const file of files) {
    const target = resolveInsideSandbox(rootDir, file.path);
    if (!target) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (file.isDirectory) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? '', 'utf8');
    await fsp.writeFile(target, data);
  }
}

async function readIfExists(filePath) {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    return null;
  }
}

/**
 * Explicación de los problemas más comunes al usar \bibliography / \addbibresource
 */
function getBibliographyFriendlyMessage(message, missingDb) {
  if (/I found no \\bibstyle/i.test(message)) {
    return 'Falta el estilo de la bibliografía: agrega \\bibliographystyle{plain} (u otro: unsrt, alpha, apalike, ieeetr...) justo antes de \\bibliography{...}. Sin él, bibtex no genera la bibliografía y las citas aparecen como [?].';
  }
  if (/I found no \\citation/i.test(message)) {
    return 'No hay ningún \\cite{...} en el documento, por eso la bibliografía sale vacía. Cita alguna referencia con \\cite{clave} o agrega \\nocite{*} para listar todas las entradas del .bib.';
  }
  if (/I found no \\bibdata/i.test(message)) {
    return 'Hay citas pero falta indicar el archivo de bibliografía: agrega \\bibliography{ruta/sin-extension} (bibtex) al final del documento.';
  }
  if (missingDb) {
    const requested = missingDb[1];
    return `No se encontró el archivo de bibliografía '${requested}'. Verifica que exista en el proyecto y que la ruta en \\bibliography{...} o \\addbibresource{...} sea relativa a la raíz del proyecto (sin la extensión .bib en \\bibliography). Los nombres de archivos .bib no pueden tener espacios: bibtex los elimina (por eso busca '${requested}'); renombra el archivo usando guiones o guiones bajos.`;
  }
  if (/didn't find a database entry for "([^"]+)"/i.test(message)) {
    const key = message.match(/entry for "([^"]+)"/i)[1];
    return `La clave '${key}' usada en \\cite{...} no existe en ningún .bib cargado. Revisa que esté bien escrita (distingue mayúsculas) y que el .bib que la contiene esté en \\bibliography{...}.`;
  }
  return null;
}

/**
 * Extrae los errores relevantes de la salida de bibtex / biber como advertencias
 * (el PDF puede generarse igual, pero con citas sin resolver).
 */
function parseBibliographyOutput(tool, output) {
  const warnings = [];
  const seen = new Set();
  const lines = String(output || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let message = null;
    if (tool === 'bibtex') {
      if (/^I couldn't open (database|style) file/i.test(line) || /^I found no \\(bibdata|bibstyle|citation)/i.test(line) || /^Warning--/.test(line) || /^Repeated entry/i.test(line)) {
        message = line;
      }
    } else if (/^(ERROR|WARN)\s+-/.test(line) || /^(ERROR|WARN)\s/.test(line)) {
      message = line.replace(/^(ERROR|WARN)\s+-\s*/, '');
    }

    if (message && !seen.has(message)) {
      seen.add(message);
      const missingDb = message.match(/(?:couldn't open database file|cannot find\s*')\s*([^'\s]+)/i);
      warnings.push({
        file: tool,
        archivo: tool,
        line: null,
        linea: null,
        message: `[${tool}] ${message}`,
        type: 'warning',
        friendlyMessage: getBibliographyFriendlyMessage(message, missingDb)
      });
    }
  }

  return warnings;
}

/**
 * Compila un proyecto LaTeX completo (varios archivos y carpetas) de forma aislada y segura.
 *
 * - Escribe todos los archivos del proyecto en un directorio temporal con la misma estructura.
 * - Ejecuta el motor sobre el archivo principal y, si el documento lo requiere, bibtex o biber
 *   (bibliografías .bib) y makeindex (índices), repitiendo pasadas hasta resolver referencias.
 * - Compila EXACTAMENTE el contenido recibido sin alterar ni corregir el código fuente.
 *
 * @param {Array<{path: string, content?: string|Buffer, isDirectory?: boolean}>} files Archivos del proyecto (rutas relativas)
 * @param {string} mainFilePath Ruta relativa del archivo .tex principal (ej. "main.tex" o "tesis/main.tex")
 * @param {object} options Opciones opcionales de compilación
 * @returns {Promise<object>} Resultado de la compilación
 */
async function compileProject(files, mainFilePath, options = {}) {
  const startTime = Date.now();
  const compilationId = options.compilationId || crypto.randomUUID();
  const timeoutMs = options.timeoutMs || config.latexTimeoutMs;
  const engine = options.engine || config.latexEngine;
  const deadline = startTime + timeoutMs;

  // Directorio temporal aislado en el SO
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `latex-sandbox-${compilationId}-`));
  const mainDisplayName = String(mainFilePath || 'document.tex').replace(/\\/g, '/');

  let logContent = '';
  let toolsOutput = '';
  let stderrBuffer = '';
  let compilationExitCode = null;
  let isTimedOut = false;
  const bibliographyWarnings = [];

  try {
    await writeProjectFiles(tempDir, files);

    const mainAbsolutePath = resolveInsideSandbox(tempDir, mainFilePath);
    if (!mainAbsolutePath || !fs.existsSync(mainAbsolutePath)) {
      throw Object.assign(new Error(`El archivo principal '${mainDisplayName}' no existe en el proyecto.`), { statusCode: 400 });
    }

    // El motor se ejecuta desde la carpeta del archivo principal. TEXINPUTS/BIBINPUTS agregan además
    // la raíz del proyecto (con subcarpetas), así funcionan rutas relativas al archivo principal y a la raíz.
    // Las entradas son relativas para que el log reporte rutas del proyecto y no del sandbox.
    // La entrada vacía final conserva las rutas por defecto de la distribución TeX.
    const workDir = path.dirname(mainAbsolutePath);
    const mainFileName = path.basename(mainAbsolutePath);
    const jobName = mainFileName.replace(/\.[^.]+$/, '');
    const rootFromWorkDir = (path.relative(workDir, tempDir) || '.').replace(/\\/g, '/');
    const searchPath = [...new Set(['.', rootFromWorkDir, `${rootFromWorkDir}//`, ''])].join(path.delimiter);
    const env = {
      ...process.env,
      TEXINPUTS: searchPath,
      BIBINPUTS: searchPath,
      BSTINPUTS: searchPath,
      // Evita que TeX corte las líneas del log a 79 caracteres (rutas y mensajes completos)
      max_print_line: '10000',
      error_line: '254',
      half_error_line: '238'
    };

    // -no-shell-escape: Bloquea \write18 y cualquier ejecución de comandos del sistema
    // -interaction=nonstopmode: Evita bloqueos en espera de entrada de usuario
    // -halt-on-error: Se detiene inmediatamente si encuentra un error grave
    // -file-line-error: Formatea los errores como archivo:línea:mensaje
    // --disable-installer: Evita que MiKTeX intente mostrar ventanas emergentes GUI en Windows
    // --max-print-line: Equivalente de max_print_line para MiKTeX
    const engineArgs = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',
      ...(process.platform === 'win32' ? ['--disable-installer', '--max-print-line=10000'] : []),
      '-no-shell-escape',
      mainFileName
    ];

    const remaining = () => deadline - Date.now();
    const logFilePath = path.join(workDir, `${jobName}.log`);

    const runEngine = async () => {
      const result = await runTool(engine, engineArgs, { cwd: workDir, env, timeoutMs: remaining() });
      compilationExitCode = result.code;
      isTimedOut = isTimedOut || result.timedOut;
      if (result.stderr) stderrBuffer += result.stderr;
      logContent = (await readIfExists(logFilePath)) || result.stdout;
      return result;
    };

    const needsRerun = () => /Rerun to get|Rerun LaTeX|Please rerun LaTeX|Please \(re\)run Biber|rerunfilecheck Warning|Label\(s\) may have changed/i.test(logContent);

    // Pasada 1
    await runEngine();

    if (compilationExitCode === 0 && !isTimedOut) {
      let ranAuxTool = false;

      // Bibliografía: biblatex+biber genera .bcf; natbib/bibtex o biblatex con backend=bibtex escriben \bibdata en el .aux
      const bcfPath = path.join(workDir, `${jobName}.bcf`);
      const auxContent = (await readIfExists(path.join(workDir, `${jobName}.aux`))) || '';
      if (fs.existsSync(bcfPath) && !/\\bibdata\{/.test(auxContent)) {
        const result = await runTool('biber', [jobName], { cwd: workDir, env, timeoutMs: remaining() });
        toolsOutput += `\n===== biber =====\n${result.stdout}${result.stderr}`;
        bibliographyWarnings.push(...parseBibliographyOutput('biber', `${result.stdout}\n${result.stderr}`));
        isTimedOut = isTimedOut || result.timedOut;
        ranAuxTool = true;
      } else if (/\\bibdata\{/.test(auxContent)) {
        const result = await runTool('bibtex', [jobName], { cwd: workDir, env, timeoutMs: remaining() });
        toolsOutput += `\n===== bibtex =====\n${result.stdout}${result.stderr}`;
        bibliographyWarnings.push(...parseBibliographyOutput('bibtex', `${result.stdout}\n${result.stderr}`));
        isTimedOut = isTimedOut || result.timedOut;
        ranAuxTool = true;
      } else if (/\\citation\{/.test(auxContent)) {
        // Hay \cite pero ningún archivo de bibliografía: bibtex/biber no tienen nada que procesar
        bibliographyWarnings.push({
          file: mainDisplayName,
          archivo: mainDisplayName,
          line: null,
          linea: null,
          message: 'Hay citas (\\cite) pero el documento no indica ningún archivo de bibliografía.',
          type: 'warning',
          friendlyMessage: 'Agrega al final del documento \\bibliographystyle{plain} y \\bibliography{ruta/sin-extension} (bibtex), o en el preámbulo \\usepackage{biblatex} con \\addbibresource{ruta/archivo.bib} y luego \\printbibliography.'
        });
      }

      // Índice alfabético (\makeindex + \printindex)
      if (!isTimedOut && fs.existsSync(path.join(workDir, `${jobName}.idx`))) {
        const result = await runTool('makeindex', [`${jobName}.idx`], { cwd: workDir, env, timeoutMs: remaining() });
        toolsOutput += `\n===== makeindex =====\n${result.stdout}${result.stderr}`;
        isTimedOut = isTimedOut || result.timedOut;
        ranAuxTool = true;
      }

      // Pasadas adicionales para resolver citas, referencias cruzadas (\ref, \pageref) y tabla de contenidos
      // (con bibliografía/índice siempre dos pasadas más; si no, solo mientras LaTeX pida recompilar)
      let extraPasses = 0;
      while (!isTimedOut && compilationExitCode === 0 && extraPasses < 3) {
        const mustRun = (ranAuxTool && extraPasses < 2) || needsRerun();
        if (!mustRun) break;
        await runEngine();
        extraPasses++;
      }
    }

    const compilationTime = Date.now() - startTime;
    const { errors, warnings } = parseLatexLog(logContent, mainDisplayName, tempDir);
    warnings.push(...bibliographyWarnings);

    if (isTimedOut) {
      errors.push({
        file: mainDisplayName,
        archivo: mainDisplayName,
        line: null,
        linea: null,
        message: `La compilación excedió el tiempo límite permitido de ${timeoutMs / 1000} segundos.`,
        type: 'error',
        context: null,
        friendlyMessage: 'La compilación tardó demasiado tiempo. Revisa posibles bucles infinitos en macros o cálculos extensos.'
      });
    }

    const pdfFilePath = path.join(workDir, `${jobName}.pdf`);
    const pdfGenerated = fs.existsSync(pdfFilePath);
    const success = pdfGenerated && compilationExitCode === 0 && !isTimedOut;
    let finalPdfPath = null;

    // Solo persistir el nuevo PDF si la compilación fue exitosa (código 0) y se generó el PDF
    if (success) {
      ensureStorageDirectories();
      finalPdfPath = path.join(COMPILATIONS_DIR, `${compilationId}.pdf`);
      await fsp.copyFile(pdfFilePath, finalPdfPath);
    }

    // Si falló pero no se extrajeron errores del log, agregar mensaje descriptivo
    if (!success && errors.length === 0) {
      errors.push({
        file: mainDisplayName,
        archivo: mainDisplayName,
        line: null,
        linea: null,
        message: stderrBuffer.trim() || 'Error durante la compilación de LaTeX.',
        type: 'error',
        context: null,
        friendlyMessage: 'El compilador terminó con error pero no se pudo determinar la línea exacta. Revisa el log completo.'
      });
    }

    return {
      success,
      compilationId,
      pdfPath: finalPdfPath,
      errors,
      warnings,
      log: `${logContent}${toolsOutput}`,
      compilationTime
    };

  } finally {
    // Eliminar el directorio temporal y sus archivos auxiliares (.aux, .log, .bbl, .out, etc.)
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`Advertencia: No se pudo limpiar el directorio temporal ${tempDir}:`, cleanupErr.message);
    }
  }
}

/**
 * Compila un único archivo .tex (sin archivos adicionales del proyecto).
 *
 * @param {string} texContent Código fuente .tex exacto
 * @param {object} options Opciones opcionales de compilación
 * @returns {Promise<object>} Resultado de la compilación
 */
async function compileLatex(texContent, options = {}) {
  return compileProject([{ path: 'document.tex', content: texContent ?? '' }], 'document.tex', options);
}

/**
 * Obtiene la ruta al archivo PDF compilado persistido
 * @param {string} compilationId Identificador de compilación
 * @returns {string|null} Ruta absoluta o null si no existe
 */
function getCompiledPdfPath(compilationId) {
  const filePath = path.join(COMPILATIONS_DIR, `${compilationId}.pdf`);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

/**
 * Elimina un PDF compilado del almacenamiento
 * @param {string} compilationId Identificador de compilación
 */
async function removeCompiledPdf(compilationId) {
  const filePath = path.join(COMPILATIONS_DIR, `${compilationId}.pdf`);
  try {
    if (fs.existsSync(filePath)) {
      await fsp.unlink(filePath);
    }
  } catch (err) {
    console.error(`Error al eliminar PDF ${compilationId}:`, err.message);
  }
}

module.exports = {
  compileLatex,
  compileProject,
  parseLatexLog,
  getFriendlyMessage,
  getCompiledPdfPath,
  removeCompiledPdf,
  COMPILATIONS_DIR
};
