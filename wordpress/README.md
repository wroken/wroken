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
3. Ejecuta `configurar-sitio` (arriba) con el id del sitio. Pide el usuario y la contraseña, los guarda solo en tu equipo (`%USERPROFILE%\.autoblog\credentials.json` o `~/.autoblog/credentials.json`) y prueba la conexión.
4. **Instala el plugin Autoblog Bridge**: comprime la carpeta `wp-plugin/autoblog-bridge` en un `.zip` y súbelo en **Plugins → Añadir nuevo → Subir plugin**, o cópiala por FTP/SSH a `wp-content/plugins/` y actívalo. Sin él se publica igual, pero sin título SEO ni meta descripción.

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

## 5. Uso dentro de una conversación

En Claude Desktop o Claude Code, por ejemplo:

- *"Ejecuta autoblog para viajesok"*
- *"Publica en ladeportiva un artículo sobre la previa del partido de Colo-Colo del domingo"*
- *"Autoblog: revisa a qué sitios les toca publicar y hazlo"*
- *"Añade a la cola de onchile estos temas: …"*
- *"Muéstrame las últimas ejecuciones de viajesok"*

## 6. Publicación automática

Cada sitio publica según su `frequency.everyHours`. La tarea automática solo tiene que **revisar cada 1–3 horas** a qué sitios les toca (`sites_due`).

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

En la nube no se guarda la cola local de temas entre ejecuciones; usa `topics.seedTopics` del perfil o deja que Claude proponga temas (los duplicados se evitan consultando WordPress).

## 7. Imágenes y derechos

- **Fotos de internet**: solo las que devuelve `images_search` (licencias que permiten uso comercial), con autor y licencia en el pie de foto. **No** se usan imágenes de Google ni de otros medios: publicar fotos sin licencia puede traer reclamaciones y la retirada del contenido.
- **Magnific**: banco de imágenes con licencia de tu plan, o imagen generada.
- **Higgsfield**: imagen generada.
- Las imágenes generadas nunca muestran personas reales reconocibles ni simulan hechos reales, y llevan el pie "Imagen ilustrativa generada con IA".

## 8. Salvaguardas

Antes de publicar, el servidor:
1. Rechaza títulos ya publicados en el sitio.
2. Limpia el HTML (bloques de código, `<h1>` duplicado).
3. Quita enlaces rotos o que llevan a páginas de error.
4. Comprueba que cada cifra y cada cita textual aparezcan en las fuentes.
5. Cuenta las fuentes por medio distinto.
6. Si la nota es baja, faltan fuentes, hay citas sin respaldo o más de 2 cifras sin respaldo, **guarda como borrador** en vez de publicar y lo explica.

Recomendación: los primeros días pon `"status": "draft"` en los perfiles, revisa los borradores y, cuando te convenza la calidad, cámbialo a `publish`.

Aviso: Google penaliza el contenido publicado en masa sin valor propio ("scaled content abuse"). Mejor pocos artículos buenos, bien documentados y con un ángulo propio que muchos genéricos.

## 9. Herramientas del servidor MCP

| Herramienta | Qué hace |
|---|---|
| `sites_list`, `site_get`, `site_save_profile`, `site_check` | Ver, crear o editar perfiles y probar la conexión. |
| `sites_due` | A qué sitios les toca publicar. |
| `run_begin`, `run_end`, `runs_recent` | Inicio y fin de una ejecución (bloqueo, contexto, registro). |
| `topics_add`, `topics_next`, `topics_list` | Cola de temas por sitio. |
| `research_search`, `research_fetch` | Buscar fuentes (Tavily/Brave) y leerlas como texto. |
| `images_search` | Fotos con licencia y atribución. |
| `content_verify` | Verifica cifras, citas, enlaces y título contra las fuentes. |
| `wp_recent_posts`, `wp_terms` | Artículos recientes y categorías/etiquetas. |
| `wp_upload_media`, `wp_create_post`, `wp_update_post` | Subir imágenes y publicar o editar. |

## 10. Solución de problemas

| Problema | Solución |
|---|---|
| Claude no ve las herramientas "autoblog" | Reinicia Claude Desktop por completo. Comprueba `%APPDATA%\Claude\claude_desktop_config.json` (Mac: `~/Library/Application Support/Claude/`). |
| `Faltan credenciales para "x"` | Ejecuta `configurar-sitio` con ese id. |
| Error 401 | Ver "Error 401" en la sección 3. |
| Error 403 al publicar | El usuario necesita rol Autor o superior; revisa el plugin de seguridad. |
| "SEO no aplicado" | Instala el plugin Autoblog Bridge. |
| Todo queda en borrador | Lee los avisos en la respuesta o en `runs_recent`: suele ser falta de fuentes o cifras sin respaldo. |
| No encuentra fotos | Openverse limita las consultas anónimas por hora; añade una clave de Pexels o usa Magnific. |

## Desarrollo

```bash
cd mcp-server
npm install
npm test            # pruebas con un WordPress simulado
node mcpb/build.mjs # desde wordpress/: genera dist/autoblog.mcpb
```
