# Autoblog para WordPress con Claude

Sistema para que Claude **investigue, redacte, ilustre y publique** artículos en varios sitios WordPress (wroken.com, viajesok.com, vi.cl, onchile.com, ladeportiva.cl y los que vayas creando), a mano dentro de una conversación o de forma automática cada cierto tiempo.

Funciona en **Windows y Mac** con Claude Desktop y/o Claude Code, y también en la nube.

```
 Tema (cola o propuesto) ─► Investigación (fuentes reales) ─► Redacción con citas
        │                                                           │
        ▼                                                           ▼
 Imágenes: fotos con licencia · Magnific · Higgsfield ─► Verificación (cifras, citas, enlaces, título)
                                                                    │
                                                                    ▼
                               WordPress: imagen destacada + artículo + SEO (Rank Math / Yoast)
```

## Qué incluye

| Carpeta | Qué es |
|---|---|
| `mcp-server/` | Servidor MCP "autoblog" (Node.js): las herramientas que usa Claude (WordPress, fuentes, imágenes, cola de temas, verificación). |
| `skills/autoblog/` | Instrucciones paso a paso que sigue Claude para cada artículo, rúbrica de calidad y guía de imágenes. |
| `skills/autoblog-sitio/` | Instrucciones para añadir o ajustar un sitio. |
| `sites/` | Un perfil `.json` por sitio (temática, tono, frecuencia, categorías, fuentes, imágenes). Sin contraseñas. |
| `wp-plugin/autoblog-bridge/` | Pequeño plugin para cada WordPress: permite escribir el SEO de Rank Math/Yoast y guarda las fuentes de cada artículo. |
| `scripts/windows/`, `scripts/mac/` | Instalador, configuración de sitios y claves, y programación automática. |
| `mcpb/` | Genera `autoblog.mcpb`, extensión de Claude Desktop instalable con doble clic. |

## En qué mejora a lo que ya existe

Revisé los plugins y proyectos similares (AutoPost AI, Draft2Publish, AI Content Writer, Sarrloop, RightBlogger, AUTO-blogger, AutoBlogix, plantillas de n8n) y tomé lo mejor de cada uno:

- **Multi-sitio de verdad**: un perfil por sitio y una sola tarea programada que publica en cada uno según su frecuencia.
- **Investigación obligatoria** con fuentes reales leídas, citas en el texto y sección de fuentes.
- **Verificación automática antes de publicar** (idea de Draft2Publish): cada cifra y cada cita textual del artículo debe aparecer en las fuentes; si no, el artículo queda como borrador.
- **Enlaces comprobados** (idea de AutoPost AI y Draft2Publish): se quitan los enlaces rotos y los que llevan a una página de error o a la portada.
- **Fuentes contadas por medio distinto**, no por URL.
- **Imágenes con licencia**: fotos de internet solo con licencia de uso comercial (Openverse, Wikimedia Commons, Pexels) y atribución automática en el pie; o generadas con Magnific/Higgsfield usando tus créditos.
- **Puerta de calidad**: autoevaluación con rúbrica; si no llega al mínimo del perfil, se guarda como borrador.
- **Sin duplicados**: rechaza títulos ya publicados, recuerda los temas usados y bloquea el sitio mientras se publica.
- **SEO con datos reales** (inspirado en SEOWriting.ai y Surfer): elige temas con Search Console y el autocompletado de Google, analiza los primeros resultados para la palabra clave (longitud, subtemas, términos, preguntas) y puntúa el SEO del borrador de 0 a 100 antes de publicar.
- **Actualiza artículos antiguos** con datos nuevos, sin cambiar la URL (suele subir posiciones más rápido que publicar uno nuevo).
- **Enlazado interno** buscando en todo el sitio, no solo en lo reciente, y detección de temas parecidos a lo ya publicado.
- **PC y nube a la vez sin choques**: bloqueo, cola de temas e historial guardados en el propio WordPress (con el plugin Bridge).
- **Franja horaria por sitio**, avisos por correo (borradores y fallos), imágenes en WebP y contraseñas cifradas (DPAPI en Windows, Llavero en Mac).
- **Usa Claude** (no una API de pago extra) y tus conectores de Magnific y Higgsfield.

---

## 1. Instalación en Windows

Requisitos: Windows 10/11, [Claude Desktop](https://claude.ai/download) y/o [Claude Code](https://code.claude.com). Node.js 20+ (el instalador lo instala con winget si falta).

1. Descarga este repositorio (botón **Code → Download ZIP** en GitHub, o `git clone`) y descomprímelo, por ejemplo en `C:\autoblog\wroken`.
2. Abre `wordpress\scripts\windows\` y haz **doble clic en `instalar.bat`**.
   - Instala las dependencias, registra el servidor en Claude Desktop y en Claude Code, copia las skills para Claude Code y crea los `.zip` de las skills en `wordpress\dist\`.
3. **Reinicia Claude Desktop** (ciérralo también desde el icono de la bandeja).
4. En Claude Desktop: **Configuración → Capacidades → Skills → Subir skill**, y sube `autoblog.zip` y `autoblog-sitio.zip` de `wordpress\dist\`.
5. Conecta los sitios (ver sección 3) con PowerShell en esa carpeta:
   ```powershell
   .\configurar-sitio.ps1 -Sitio viajesok
   ```
   Si PowerShell bloquea los scripts: `powershell -ExecutionPolicy Bypass -File .\configurar-sitio.ps1 -Sitio viajesok`
6. Opcional: `.\configurar-claves.ps1` para Tavily/Brave (búsqueda de fuentes) y Pexels (más fotos).

**Alternativa sin instalador** (solo Claude Desktop): genera `wordpress\dist\autoblog.mcpb` con `node mcpb\build.mjs`, haz doble clic sobre él, y en la configuración de la extensión elige la carpeta `wordpress\sites`.

## 2. Instalación en Mac

```bash
cd wroken/wordpress/scripts/mac
bash instalar.sh
bash configurar-sitio.sh viajesok
bash configurar-claves.sh      # opcional
```
Luego reinicia Claude Desktop y sube los `.zip` de `wordpress/dist/` en **Configuración → Capacidades → Skills**.

## 3. Preparar cada WordPress

Hazlo una vez por sitio:

1. **Crea un usuario para Autoblog** (por ejemplo `autoblog`) con rol **Autor** o **Editor**. Así sabes qué publicó el sistema, y el sistema calcula la frecuencia por la fecha de los artículos de ese usuario.
2. Con ese usuario: **Usuarios → Perfil → Contraseñas de aplicación**, escribe "Autoblog" y pulsa *Añadir*. Copia la contraseña (formato `abcd efgh ijkl mnop qrst uvwx`).
3. Ejecuta `configurar-sitio` (arriba) con el id del sitio. Pide el usuario y la contraseña, la guarda **cifrada** solo en tu equipo (Windows: cifrado DPAPI de tu usuario en `%USERPROFILE%\.autoblog\credentials.json`; Mac: en el Llavero) y prueba la conexión.
4. **Instala el plugin Autoblog Bridge** (muy recomendado): comprime la carpeta `wp-plugin/autoblog-bridge` en un `.zip` y súbelo en **Plugins → Añadir nuevo → Subir plugin**, o cópiala por SSH a `wp-content/plugins/` y actívalo. Aporta:
   - título SEO, meta descripción y palabra clave de **Rank Math o Yoast**;
   - **bloqueo compartido**, cola de temas e historial guardados en WordPress (el PC y la nube no publican a la vez y comparten la cola);
   - **avisos por correo** con el correo de WordPress (configura SMTP si tu servidor no envía correo);
   - tamaños de imagen en **WebP**;
   - un recuadro en el editor con las fuentes y la puntuación de cada artículo.

### Error 401 aunque la contraseña sea correcta
Algunos servidores Apache/CGI no pasan la cabecera de autenticación. Añade al principio del `.htaccess` del sitio:
```apache
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
```
Comprueba también que ningún plugin de seguridad (Wordfence, iThemes, etc.) bloquee la API REST o las contraseñas de aplicación, y que el firewall del servidor (Cloudflare, ModSecurity) no bloquee las peticiones a `/wp-json/`.

## 4. Perfiles de sitio

Cada sitio es un archivo en `sites/` (copia `_plantilla.json`). Lo más importante:

| Campo | Para qué |
|---|---|
| `id`, `url`, `name`, `language` | Identificación. El `id` es el que usas en los comandos (`viajesok`). |
| `enabled` | `false` para pausar un sitio. |
| `niche`, `audience`, `tone`, `guidelines` | Línea editorial. Cuanto más concreto, mejores artículos. |
| `frequency.everyHours` | Cada cuántas horas publicar (24 = uno al día). `maxPostsPerRun`: cuántos por ejecución. |
| `publishing.status` | `publish` (automático) o `draft`. `minQualityScore`: nota mínima para publicar (si no, borrador). |
| `content` | Longitud, número mínimo de medios como fuente, FAQ, sección de fuentes, enlaces internos. |
| `categories` | Categorías del sitio que Autoblog puede usar. |
| `topics.pillars` / `seedTopics` / `avoid` | Temas principales, ideas iniciales y temas prohibidos. |
| `sources.preferred` / `blocked` | Dominios preferidos y prohibidos como fuente. |
| `images.featured` | Orden de preferencia: `internet`, `magnific`, `higgsfield`. `style`: estilo visual de las imágenes generadas. |

> **Importante:** no pude abrir los sitios desde aquí, así que los perfiles tienen temáticas **supuestas**. `wroken` y `vicl` están desactivados hasta que pongas su temática (donde dice "REVISAR"). Lo más fácil es pedírselo a Claude: *"Revisa el perfil de onchile: lee la portada y ajusta temática, tono, categorías y pilares"*.

**Añadir un sitio nuevo**: dile a Claude *"Añade el sitio misitio.cl al autoblog"* (usa la skill `autoblog-sitio`) y luego ejecuta `configurar-sitio` con su id.

## 5. SEO: cómo elige temas y por qué puede posicionar

**Qué hace el sistema** (lo que depende del contenido):
1. **Tema con demanda real**: busca en Search Console las búsquedas donde tu sitio ya aparece pero muy abajo (`seo_opportunities`) y usa el autocompletado de Google sobre tus pilares (`seo_keyword_ideas`). Prefiere frases concretas con intención clara (menos competencia).
2. **Analiza a quién hay que ganarle**: lee los primeros resultados de Google para la palabra clave (`seo_serp_analysis`): longitud, subtemas, términos que usan todos y preguntas de la gente.
3. **Escribe para superar** esos resultados: cubre los subtemas, añade lo que no tienen (datos actuales con fuente, consejos prácticos, tablas), FAQ con preguntas reales, enlaces internos y fuentes.
4. **Puntúa el SEO** del borrador (`seo_content_score`, 0–100) y corrige hasta el objetivo del perfil (`seo.minContentScore`, 70).
5. **SEO técnico en página**: título y meta con la palabra clave, slug limpio, alt de imágenes, imagen ≥ 1200 px, WebP, Rank Math/Yoast.
6. **Actualiza** periódicamente los artículos que están entre el puesto 4 y el 20 o que llevan meses sin tocarse.

**Lo que no depende del sistema** (y nadie puede garantizar): la autoridad del dominio y los enlaces de otras webs, la competencia de cada búsqueda, la velocidad y la salud técnica del sitio (hosting, caché, Core Web Vitals), que Google indexe las páginas y sus actualizaciones de algoritmo. Para un sitio nuevo, los resultados suelen tardar de 3 a 6 meses. Publicar mucho contenido sin valor propio puede **perjudicar** al sitio (política de Google sobre "contenido a escala").

Consejos: registra cada sitio en [Search Console](https://search.google.com/search-console) y envía el sitemap de Rank Math/Yoast; agrupa los artículos por temas (un pilar con artículos que lo enlazan); y revisa de vez en cuando los borradores y los informes de `runs_recent`.

### Conectar Search Console (recomendado)

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto, activa **Google Search Console API** y crea una **cuenta de servicio** (IAM → Cuentas de servicio → Crear). En la cuenta, pestaña **Claves → Agregar clave → JSON**: se descarga un archivo `.json`. Guárdalo en un lugar seguro.
2. En Search Console, en cada propiedad: **Configuración → Usuarios y permisos → Añadir usuario**, pega el correo de la cuenta de servicio (`...@...iam.gserviceaccount.com`) con permiso **Restringido**.
3. Ejecuta `configurar-claves` y, en la pregunta de Search Console, pega la **ruta del archivo `.json`**. En la nube, crea la variable `GOOGLE_SERVICE_ACCOUNT_JSON` con el **contenido** del archivo.
4. Comprueba con Claude: *"site_check de viajesok"* (debe decir `searchConsole: ok`). Si la propiedad es de tipo URL en vez de dominio, pon en el perfil `"searchConsole": { "property": "https://viajesok.com/" }`.

### ¿Y SEOWriting.ai?
No tiene una API pública que se pueda conectar de forma fiable, así que no se integra directamente; manejarlo desde Chrome sería frágil y gastaría tus créditos. Autoblog incorpora lo que lo hace bueno (análisis de los primeros resultados, términos y puntuación SEO) y además verifica fuentes, cifras y citas contra lo que dicen las fuentes. Puedes seguir usando SEOWriting.ai para artículos puntuales en paralelo: Autoblog detecta los temas ya publicados y no los repite.

## 6. Uso dentro de una conversación

En Claude Desktop o Claude Code, por ejemplo:

- *"Ejecuta autoblog para viajesok"*
- *"Publica en ladeportiva un artículo sobre la previa del partido de Colo-Colo del domingo"*
- *"Autoblog: revisa a qué sitios les toca publicar y hazlo"*
- *"Añade a la cola de onchile estos temas: …"*
- *"Muéstrame las últimas ejecuciones de viajesok"*
- *"Busca oportunidades SEO de viajesok y carga 10 temas en la cola"*
- *"Actualiza el artículo más antiguo de onchile"*
- *"Analiza la palabra clave 'qué ver en valparaíso' y dime cómo superar a los primeros resultados"*

## 7. Publicación automática

Cada sitio publica según su `frequency.everyHours` y dentro de su franja horaria `publishing.hours` (hora de Chile por defecto). La tarea automática solo tiene que **revisar cada 1–3 horas** a qué sitios les toca (`sites_due`); los borradores también cuentan, así que un artículo que no pasó los controles no provoca reintentos cada 2 horas. Una vez por semana (`refresh.everyHours`) también actualiza un artículo antiguo.

### Opción A: tareas programadas de Claude Desktop (la más simple)
Si tu Claude Desktop tiene **Tareas programadas** (en Cowork), crea una cada 2 horas con el texto:
> Usa la skill autoblog para publicar en todos los sitios a los que les toca.

Requiere el PC encendido y Claude Desktop abierto.

### Opción B: Programador de tareas de Windows / launchd en Mac (con Claude Code)
Requiere [Claude Code](https://code.claude.com) instalado y con la sesión iniciada (ejecuta `claude` una vez).
```powershell
.\programar.ps1 -CadaHoras 2            # Windows: todos los sitios
.\programar.ps1 -Quitar                  # eliminar la tarea
```
```bash
bash programar.sh 2                      # Mac
bash programar.sh quitar
```
Registros en `~/.autoblog/logs`. El equipo debe estar encendido y con la sesión iniciada.

Si en modo automático no se usan Magnific o Higgsfield, comprueba sus nombres con `claude mcp list` y ajusta la lista `$tools` de `ejecutar-autoblog.ps1` (o `TOOLS` en el `.sh`). Si fallan, Autoblog usa fotos de internet.

### Opción C: en la nube, con el PC apagado
Claude Code en la nube puede ejecutar este repositorio con una tarea programada (el repo ya trae `.mcp.json` en la raíz).

1. En el entorno de la nube (claude.ai/code → entorno → *Editar*):
   - **Variables de entorno**, por cada sitio: `AUTOBLOG_VIAJESOK_USER` y `AUTOBLOG_VIAJESOK_APP_PASSWORD` (id del sitio en mayúsculas). Opcional: `TAVILY_API_KEY`, `PEXELS_API_KEY`.
   - **Acceso a red**: añade tus dominios (`viajesok.com`, `onchile.com`, …) y `api.openverse.org`, `commons.wikimedia.org`, `api.tavily.com`, `api.pexels.com`, o elige acceso completo (las fuentes de las noticias pueden estar en cualquier dominio).
2. Crea una tarea programada en ese entorno, cada 2 horas, con el texto:
   > Lee wordpress/skills/autoblog/SKILL.md y síguelo para publicar en todos los sitios a los que les toca.

Con el plugin Bridge instalado, la nube y tu PC comparten la cola de temas, el historial y el bloqueo (todo se guarda en WordPress), así que puedes usar ambos a la vez. Sin el plugin, la nube no conserva la cola entre ejecuciones.

## 8. Imágenes y derechos

- **Fotos de internet**: solo las que devuelve `images_search` (licencias que permiten uso comercial), con autor y licencia en el pie de foto. **No** se usan imágenes de Google ni de otros medios: publicar fotos sin licencia puede traer reclamaciones y la retirada del contenido.
- **Magnific**: banco de imágenes con licencia de tu plan, o imagen generada.
- **Higgsfield**: imagen generada.
- Las imágenes generadas nunca muestran personas reales reconocibles ni simulan hechos reales, y llevan el pie "Imagen ilustrativa generada con IA".

## 9. Salvaguardas

Antes de publicar, el servidor:
1. Rechaza títulos ya publicados y pasa a borrador los casi iguales a uno existente.
2. Limpia el HTML (bloques de código, `<h1>` duplicado).
3. Quita enlaces rotos o que llevan a páginas de error.
4. Comprueba que cada cifra y cada cita textual aparezcan en las fuentes.
5. Cuenta las fuentes por medio distinto.
6. Si la nota es baja, faltan fuentes, hay citas sin respaldo o más de 2 cifras sin respaldo, **guarda como borrador** en vez de publicar y lo explica.

Recomendación: los primeros días pon `"status": "draft"` en los perfiles, revisa los borradores y, cuando te convenza la calidad, cámbialo a `publish`.

Aviso: Google penaliza el contenido publicado en masa sin valor propio ("scaled content abuse"). Mejor pocos artículos buenos, bien documentados y con un ángulo propio que muchos genéricos.

## 10. Herramientas del servidor MCP

| Herramienta | Qué hace |
|---|---|
| `sites_list`, `site_get`, `site_save_profile`, `site_check` | Ver, crear o editar perfiles y probar la conexión. |
| `sites_due` | A qué sitios les toca publicar o actualizar (frecuencia, franja horaria, borradores). |
| `run_begin`, `run_end`, `runs_recent` | Inicio y fin de una ejecución (bloqueo, contexto, registro). |
| `topics_add`, `topics_next`, `topics_list`, `topics_check_similar` | Cola de temas por sitio y detección de temas ya cubiertos. |
| `seo_keyword_ideas`, `seo_opportunities`, `seo_search_console` | Palabras clave reales (autocompletado de Google) y datos de Search Console. |
| `seo_serp_analysis`, `seo_content_score` | Análisis de los primeros resultados y puntuación SEO del borrador. |
| `research_search`, `research_fetch` | Buscar fuentes (Tavily/Brave) y leerlas como texto. |
| `images_search` | Fotos con licencia y atribución. |
| `content_verify` | Verifica cifras, citas, enlaces y título contra las fuentes. |
| `wp_recent_posts`, `wp_terms`, `wp_find_related`, `wp_stale_posts`, `wp_get_post` | Artículos recientes, relacionados (enlazado interno) y antiguos; categorías y etiquetas. |
| `notify_send` | Correo con el sistema de WordPress (requiere el plugin Bridge). |
| `wp_upload_media`, `wp_create_post`, `wp_update_post` | Subir imágenes y publicar o editar. |

## 11. Solución de problemas

| Problema | Solución |
|---|---|
| Claude no ve las herramientas "autoblog" | Reinicia Claude Desktop por completo. Comprueba `%APPDATA%\Claude\claude_desktop_config.json` (Mac: `~/Library/Application Support/Claude/`). |
| `Faltan credenciales para "x"` | Ejecuta `configurar-sitio` con ese id. |
| Error 401 | Ver "Error 401" en la sección 3. |
| Error 403 al publicar | El usuario necesita rol Autor o superior; revisa el plugin de seguridad. |
| "SEO no aplicado" | Instala el plugin Autoblog Bridge. |
| Todo queda en borrador | Lee los avisos en la respuesta o en `runs_recent`: suele ser falta de fuentes o cifras sin respaldo. |
| No encuentra fotos | Openverse limita las consultas anónimas por hora; añade una clave de Pexels o usa Magnific. |
| No publica a cierta hora | Revisa `publishing.hours` y `publishing.timezone` del perfil (`sites_due` explica el motivo). |
| `searchConsole: error` | Revisa que el correo de la cuenta de servicio esté añadido a la propiedad y que la propiedad del perfil coincida (`sc-domain:` o URL). |
| No llegan los avisos | Tu WordPress no envía correo: instala un plugin SMTP (WP Mail SMTP, FluentSMTP). |

## Desarrollo

```bash
cd mcp-server
npm install
npm test            # pruebas con un WordPress simulado (también corren en Windows y Mac con GitHub Actions)
node mcpb/build.mjs # desde wordpress/: genera dist/autoblog.mcpb
```
