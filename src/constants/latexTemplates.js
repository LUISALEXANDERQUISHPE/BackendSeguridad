/**
 * Plantilla inicial por defecto para el archivo principal de un proyecto o documento nuevo.
 */
const DEFAULT_LATEX_TEMPLATE = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage[spanish]{babel}
\usepackage{amsmath}
\usepackage{graphicx}

\title{Mi Documento}
\author{Autor}
\date{\today}

\begin{document}

\maketitle

\section{Introducción}
¡Bienvenido al editor LaTeX! Puedes comenzar a escribir tu código aquí.

\end{document}
`;

module.exports = { DEFAULT_LATEX_TEMPLATE };
