---
name: autoblog-sitio
description: Añade un sitio WordPress nuevo a Autoblog o ajusta el perfil editorial de uno existente (temática, tono, frecuencia, categorías, fuentes, imágenes). Úsala cuando digan "añade el sitio X", "configura <sitio> para el autoblog", "cambia la frecuencia de <sitio>" o similares.
---

# Configurar un sitio en Autoblog

Cada sitio tiene un perfil JSON (sin contraseñas) con la misma forma que `sites/_plantilla.json`. Lo creas o modificas con `site_save_profile`.

## Sitio nuevo

1. Pide (o deduce) lo básico: URL, nombre, idioma, de qué trata, para quién escribe, tono y cada cuántas horas publicar.
2. Si el sitio ya tiene contenido, investígalo antes de proponer el perfil:
   - Lee la portada y 2–3 artículos con `research_fetch` para captar temática, tono y longitud.
   - Si ya hay credenciales: `wp_terms(site, "categories")` y `wp_recent_posts(site)` para usar sus categorías reales y ver de qué escribe.
3. Propón el perfil completo y, si el usuario está presente, confírmalo. Rellena:
   - `id`: corto, minúsculas, sin puntos (`viajesok`, `vicl`).
   - `niche`, `audience`, `tone`, `guidelines` (reglas concretas: "precios en CLP", "tutear", "citar siempre la fuente oficial").
   - `frequency.everyHours`, `frequency.maxPostsPerRun`.
   - `publishing.status` (`publish` o `draft`), `publishing.minQualityScore` (7 por defecto), `publishing.defaultCategory`.
   - `categories`: las del sitio que Autoblog puede usar.
   - `topics.pillars` (4–8 temas principales), `topics.seedTopics` (10–20 ideas iniciales concretas) y `topics.avoid`.
   - `sources.preferred` (dominios fiables del nicho) y `sources.blocked`.
   - `images.featured` (orden de preferencia entre `internet`, `magnific`, `higgsfield`), `images.style`, `images.inContent`.
4. Guarda con `site_save_profile(profile)`.
5. Credenciales: **no las pidas en el chat**. Indica al usuario que ejecute en su equipo el script `configurar-sitio` (Windows: `scripts\windows\configurar-sitio.ps1 -Sitio <id>`; Mac: `scripts/mac/configurar-sitio.sh <id>`), que pide usuario y contraseña de aplicación de WordPress y las guarda en local. Explica cómo crear la contraseña de aplicación: WordPress → Usuarios → Perfil → "Contraseñas de aplicación".
6. Cuando estén, `site_check(site)` y comenta el resultado (permisos, plugin SEO, si falta el plugin Autoblog Bridge).
7. Opcional: añade temas a la cola con `topics_add`.

## Ajustar un sitio

Lee el perfil con `site_get`, cambia solo lo pedido y guarda con `site_save_profile` (combina con lo existente). Si el perfil tenía "REVISAR" en `niche`, sustitúyelo por la descripción real.
