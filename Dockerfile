# Backend SecureLeaf: Node.js + TeX Live para compilar LaTeX
# Funciona en x86_64 (Azure, AWS) y en ARM (Oracle Ampere).

FROM node:24-trixie-slim

# Distribución LaTeX. A diferencia de MiKTeX, TeX Live NO descarga paquetes al vuelo:
# todo lo que usen los documentos debe estar instalado aquí. Este conjunto cubre las
# plantillas del sistema (IEEEtran, elsarticle, beamer, biblatex APA/Chicago/MLA/Vancouver,
# babel en español) y los paquetes más comunes (tikz, siunitx, algorithm, etc.).
# Para tener TODO (~5 GB) construye con:  --build-arg TEXLIVE_PACKAGES="texlive-full"
ARG TEXLIVE_PACKAGES="texlive-latex-base texlive-latex-recommended texlive-latex-extra \
  texlive-fonts-recommended texlive-lang-spanish texlive-bibtex-extra texlive-publishers \
  texlive-science texlive-pictures texlive-plain-generic biber lmodern cm-super"

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends $TEXLIVE_PACKAGES \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero (se reutiliza la caché de Docker si package*.json no cambia)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY templates ./templates
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=5000

# Sin privilegios de root: si alguien lograra escapar del sandbox de LaTeX, no controla el contenedor
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
