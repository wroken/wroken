# Actualizar un artículo antiguo

Actualizar artículos que ya tienen algo de tráfico o antigüedad suele subir más posiciones que publicar uno nuevo: Google premia el contenido al día y la página ya tiene historial.

1. `run_begin(site, mode="refresh")` (si `started` es `false`, salta el sitio). Termina siempre con `run_end`.
2. Elige **un** artículo, por este orden:
   - Si hay Search Console: `seo_opportunities(site)` → `improveExisting` (búsquedas donde la página está entre el puesto 4 y el 20; es la mejora con más impacto) o `improveTitles` (buena posición, pocos clics).
   - Si no: uno de `staleCandidates` (los que llevan más tiempo sin actualizarse) cuyo tema siga vigente.
3. `wp_get_post(site, post_id)` para leer el contenido actual.
4. Palabra clave: la de la oportunidad de Search Console, o la del artículo (`meta.rank_math_focus_keyword` / `meta._yoast_wpseo_focuskw`, o la deduces del título).
5. `seo_serp_analysis(keyword)`: compara con lo que hoy está arriba. Qué subtemas, preguntas o datos faltan.
6. Investiga datos nuevos (paso 5 de la skill principal): precios, horarios, resultados, normativa, cambios del último año. Revisa que los enlaces sigan vivos.
7. Edita sin destruir:
   - **No cambies el slug ni la URL.**
   - Conserva lo que sigue siendo correcto; corrige lo desactualizado; añade las secciones que faltan y las preguntas frecuentes nuevas.
   - Actualiza el año o la fecha si aparece en el título y el contenido de verdad cambió.
   - Si venía de `improveTitles`: reescribe `title`, `seo.title` y `seo.description` para mejorar el clic (más concreto, beneficio claro, palabra clave al principio).
   - Añade 1–3 enlaces internos nuevos con `wp_find_related`.
   - Opcional: añade al principio una nota breve "Actualizado el <fecha>: <qué cambió>".
8. `seo_content_score` y `content_verify` con el contenido nuevo, como en un artículo nuevo.
9. `wp_update_post(site, post_id, content, title?, seo?, sources, refreshed=true)`.
10. `run_end(site, run_id, outcome="refreshed", post_id, post_url, notes="qué se actualizó y por qué")`.
