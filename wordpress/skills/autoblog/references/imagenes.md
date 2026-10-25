# Imágenes: fuentes, prompts y subida

El perfil del sitio decide el orden en `images.featured` (p. ej. `["internet", "magnific", "higgsfield"]`). Usa la primera que dé una imagen buena y pasa a la siguiente si falla, no hay créditos o el conector no está disponible.

## Fotos reales de internet (`internet`)

1. `images_search(query, count=8, orientation="landscape")`. La consulta en inglés y concreta da mejores resultados: `"Valparaiso colorful houses hills"`, no `"viajes"`.
2. Mira `title`, `width` y el proveedor; descarta las de menos de 1200 px de ancho para la destacada.
3. Sube con `wp_upload_media(source_url=imageUrl, caption=attributionHtml, alt_text=..., filename=...)`.
4. La atribución en el pie es obligatoria si `attributionRequired` es `true` (y recomendable siempre).

Proveedores: Openverse (Flickr y otros, Creative Commons con uso comercial), Wikimedia Commons (excluye licencias "NC") y Pexels (requiere `PEXELS_API_KEY`).
No uses imágenes de Google Imágenes, de las fuentes del artículo ni de redes sociales: no tienen licencia.

## Magnific (`magnific`)

- **Banco de imágenes** (fotos con licencia del plan): `stock_search` → elige → `stock_download` (o `stock_to_creation`) para obtener una URL descargable. Ideal para temas genéricos (comida, oficina, paisajes, deportes en general).
- **Generar**: `images_generate` con el prompt, espera con `creations_wait` y usa la URL del resultado. Si no conoces el modelo, mira `images_models_list` y elige uno fotorrealista.
- Las URL de Magnific pueden caducar: sube a WordPress en cuanto la tengas.

## Higgsfield (`higgsfield`)

- `generate_image` con el prompt y relación de aspecto `16:9` (o la del perfil), espera con `jobs_wait` y usa la URL del resultado.
- Si dudas de qué modelo usar, `models_explore(action: "recommend")`.

## Cómo escribir el prompt

```
<sujeto concreto del artículo>, <escena y contexto>, <images.style del perfil>,
composición horizontal 16:9, alta resolución
Evitar: texto, letras, logos, marcas de agua, manos deformes, baja calidad, borroso
```

- Describe lo que se ve, no el titular. "Mochilero mirando el mapa en el Valle de la Luna al atardecer" mejor que "Guía para viajar barato".
- Sin personas reales reconocibles, sin escudos ni camisetas de clubes reales, sin marcas.
- Sin personajes con derechos de autor (dibujos, películas, videojuegos) ni imágenes engañosas (que parezcan una foto de un hecho real).
- Evita el tono azulado dominante típico de las imágenes de IA: pide luz natural y colores realistas.
- Para imágenes dentro del texto, un prompt por sección: basado en el `<h2>` donde va la imagen. Alt: "<qué se ve> — <tema del artículo>".
- Pie de foto para imágenes generadas: `Imagen ilustrativa generada con IA`.

## Nombre de archivo y alt

- `filename`: palabras clave con guiones, sin tildes: `valparaiso-cerros-casas-colores`.
- `alt_text`: lo que se ve, en el idioma del sitio, 8–15 palabras.
