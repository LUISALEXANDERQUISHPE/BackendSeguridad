# Plantillas LaTeX del sistema (HU-16)

Cada carpeta es una plantilla **base de solo lectura**. La aplicación nunca las modifica ni las
elimina: al usar una plantilla se crea una **copia** como proyecto nuevo del usuario.

| Plantilla | Carpeta | Norma / clase | Bibliografía |
|---|---|---|---|
| Tesis de grado | `tesis-grado` | `report` | BibTeX |
| Artículo científico | `articulo-cientifico` | `article` (IMRyD) | BibTeX |
| Artículo IEEE (conferencia) | `articulo-ieee` | `IEEEtran` conference | BibTeX (IEEEtran) |
| Artículo IEEE (revista) | `articulo-ieee-revista` | `IEEEtran` journal | BibTeX (IEEEtran) |
| Artículo Elsevier | `articulo-elsevier` | `elsarticle` | BibTeX (elsarticle-num) |
| Artículo APA 7 | `articulo-apa` | APA 7.ª edición | biblatex-apa + biber |
| Artículo estilo Vancouver | `articulo-vancouver` | Vancouver (ICMJE) | biblatex-vancouver + biber |
| Artículo estilo Chicago | `articulo-chicago` | Chicago autor-fecha | biblatex-chicago + biber |
| Ensayo estilo MLA | `ensayo-mla` | MLA 9.ª edición | biblatex-mla + biber |
| Artículo estilo Harvard | `articulo-harvard` | Harvard (autor-año) | biblatex + biber |
| Informe técnico | `informe-tecnico` | `article` | — |
| Presentación Beamer | `presentacion-beamer` | `beamer` 16:9 | — |
| Carta formal | `carta-formal` | `article` | — |
| Currículum vitae | `curriculum` | `article` | — |

## Requisitos del servidor (MiKTeX)

El backend compila con `--disable-installer`, así que **los paquetes deben estar instalados de
antemano**. Además de la instalación básica de MiKTeX (que incluye `IEEEtran`, `beamer`, `biblatex`
y `biber`), ejecuta una vez en el servidor:

```bash
miktex packages install translator amscls biblatex-apa biblatex-vancouver biblatex-chicago biblatex-mla xstring
```

- `translator` y `amscls`: dependencias de **Beamer** (sin ellas ninguna presentación compila).
- `biblatex-apa`, `biblatex-vancouver`, `biblatex-chicago`, `biblatex-mla`: estilos de citación.
- `xstring`: dependencia de `biblatex-chicago`.

Con TeX Live en lugar de MiKTeX: `tlmgr install translator amscls biblatex-apa biblatex-vancouver biblatex-chicago biblatex-mla xstring`.

## Agregar o modificar una plantilla

1. Crea una carpeta con nombre en minúsculas y guiones (ej. `articulo-acm`).
2. Agrega `template.json` con `id` (UUID nuevo), `name`, `category`
   (`tesis`, `articulo`, `normas`, `informe`, `presentacion`, `carta` o `cv`), `description`,
   `mainFile` (único `.tex` en la raíz), `tags` y `order`.
3. Agrega los archivos (`main.tex`, `.bib`, subcarpetas...).
4. Ejecuta `npm run templates:previews`: compila **todas** las plantillas con el mismo compilador
   del editor, genera su `preview.pdf` y falla si alguna no compila.
5. Ejecuta `npm test`: las pruebas del catálogo verifican que cada plantilla esté bien armada.

Al reiniciar el backend, el catálogo se registra automáticamente en la tabla `plantillas`.
