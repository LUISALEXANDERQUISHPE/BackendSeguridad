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

  // 7. Error: File not found (paquete faltante)
  const fileNotFound = message.match(/file [`']([^']+\.sty)['`] not found/i);
  if (fileNotFound) {
    return `El paquete '${fileNotFound[1]}' no se encuentra instalado en el servidor.`;
  }

  return null;
}

/**
 * Analiza el archivo de log y la salida de pdflatex para extraer
 * errores con su número de línea real, archivo, mensajes, tipo de error,
 * fragmento de contexto y mensaje amigable explicativo.
 *
 * @param {string} logContent Contenido del archivo .log o stdout
 * @param {string} defaultFileName Nombre esperado del archivo tex
 * @returns {{ errors: Array, warnings: Array }}
 */
function parseLatexLog(logContent, defaultFileName = 'document.tex') {
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
    const fileLineMatch = line.match(/^([^:\n]+\.tex):(\d+):\s*(.+)$/i);
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
          (nextLine.match(/^([^:\n]+\.tex):(\d+):/i) || nextLine.startsWith('! ')) &&
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

      const fileName = path.basename(filePath);
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
 * Servicio de compilación de código LaTeX a PDF de forma aislada y segura.
 *
 * Compila EXACTAMENTE el contenido recibido sin alterar, truncar ni aplicar
 * correcciones automáticas sobre el código fuente .tex.
 *
 * @param {string} texContent Código fuente .tex exacto
 * @param {object} options Opciones opcionales de compilación
 * @returns {Promise<object>} Resultado de la compilación
 */
async function compileLatex(texContent, options = {}) {
  const startTime = Date.now();
  const compilationId = options.compilationId || crypto.randomUUID();
  const timeoutMs = options.timeoutMs || config.latexTimeoutMs;
  const engine = options.engine || config.latexEngine;

  // Directorio temporal aislado en el SO
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `latex-sandbox-${compilationId}-`));
  const texFileName = 'document.tex';
  const texFilePath = path.join(tempDir, texFileName);
  const pdfFilePath = path.join(tempDir, 'document.pdf');
  const logFilePath = path.join(tempDir, 'document.log');

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let logContent = '';
  let compilationExitCode = null;
  let isTimedOut = false;

  try {
    // Escribir EXACTAMENTE el contenido recibido del usuario sin modificaciones
    await fsp.writeFile(texFilePath, texContent ?? '', 'utf8');

    // Argumentos de seguridad y ejecución no interactiva
    // -no-shell-escape: Bloquea \write18 y cualquier ejecución de comandos del sistema
    // -interaction=nonstopmode: Evita bloqueos en espera de entrada de usuario
    // -halt-on-error: Se detiene inmediatamente si encuentra un error grave
    // -file-line-error: Formatea los errores como archivo:línea:mensaje
    // --disable-installer: Evita que MiKTeX intente mostrar ventanas emergentes GUI en Windows
    const compilerArgs = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',
      '--disable-installer',
      '-no-shell-escape',
      texFileName
    ];

    await new Promise((resolve) => {
      const child = spawn(engine, compilerArgs, {
        cwd: tempDir,
        windowsHide: true,
        timeout: timeoutMs
      });

      const timer = setTimeout(() => {
        isTimedOut = true;
        try {
          child.kill('SIGKILL');
        } catch (e) {
          // Proceso ya terminado
        }
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        stdoutBuffer += data.toString('utf8');
      });

      child.stderr.on('data', (data) => {
        stderrBuffer += data.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        stderrBuffer += `\nError al ejecutar el compilador (${engine}): ${err.message}`;
        resolve();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        compilationExitCode = code;
        resolve();
      });
    });

    // Leer el archivo .log generado si existe
    if (fs.existsSync(logFilePath)) {
      try {
        logContent = await fsp.readFile(logFilePath, 'utf8');
      } catch (readErr) {
        logContent = stdoutBuffer;
      }
    } else {
      logContent = stdoutBuffer;
    }

    const compilationTime = Date.now() - startTime;
    const { errors, warnings } = parseLatexLog(logContent || stdoutBuffer, texFileName);

    if (isTimedOut) {
      errors.push({
        file: texFileName,
        archivo: texFileName,
        line: null,
        linea: null,
        message: `La compilación excedió el tiempo límite permitido de ${timeoutMs / 1000} segundos.`,
        type: 'error',
        context: null,
        friendlyMessage: 'La compilación tardó demasiado tiempo. Revisa posibles bucles infinitos en macros o cálculos extensos.'
      });
    }

    const pdfGenerated = fs.existsSync(pdfFilePath);
    let finalPdfPath = null;

    // Solo persistir el nuevo PDF si la compilación fue exitosa (código 0) y se generó el PDF
    if (pdfGenerated && compilationExitCode === 0) {
      ensureStorageDirectories();
      finalPdfPath = path.join(COMPILATIONS_DIR, `${compilationId}.pdf`);
      await fsp.copyFile(pdfFilePath, finalPdfPath);
    }

    // Si falló el código pero no se extrajeron errores del log, agregar mensaje descriptivo
    if (!pdfGenerated && errors.length === 0) {
      errors.push({
        file: texFileName,
        archivo: texFileName,
        line: null,
        linea: null,
        message: stderrBuffer || 'Error durante la compilación de LaTeX.',
        type: 'error',
        context: null,
        friendlyMessage: 'El compilador terminó con error pero no se pudo determinar la línea exacta. Revisa el log completo.'
      });
    }

    return {
      success: pdfGenerated && compilationExitCode === 0,
      compilationId,
      pdfPath: finalPdfPath,
      errors,
      warnings,
      log: logContent || stdoutBuffer,
      compilationTime
    };

  } finally {
    // Eliminar el directorio temporal y sus archivos auxiliares (.aux, .log, .out, etc.)
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`Advertencia: No se pudo limpiar el directorio temporal ${tempDir}:`, cleanupErr.message);
    }
  }
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
  parseLatexLog,
  getFriendlyMessage,
  getCompiledPdfPath,
  removeCompiledPdf,
  COMPILATIONS_DIR
};
