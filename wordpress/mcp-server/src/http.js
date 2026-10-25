// Utilidades HTTP comunes (timeouts, límite de tamaño, solo http/https).

const UA = "AutoblogMCP/1.0 (+https://github.com/wroken/wroken)";
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export function assertHttpUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`URL inválida: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Solo se admiten URLs http/https: ${url}`);
  }
  return u;
}

export async function request(url, { method = "GET", headers = {}, body, timeoutMs = 30000 } = {}) {
  assertHttpUrl(url);
  const res = await fetch(url, {
    method,
    headers: { "User-Agent": UA, ...headers },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function download(url, { maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 60000 } = {}) {
  const res = await request(url, { timeoutMs });
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`Archivo demasiado grande (${declared} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`Archivo demasiado grande (${buf.length} bytes)`);
  return { buffer: buf, contentType: (res.headers.get("content-type") || "").split(";")[0].trim(), finalUrl: res.url };
}
