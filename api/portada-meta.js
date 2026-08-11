// Vercel Serverless Function — SOLO para bots de redes sociales/buscadores,
// para la PORTADA pública (/restaurante/:id). Mismo patrón que
// api/carta-meta.js (que NO se toca — ver instrucción del brief), pero como
// función separada e independiente en vez de generalizar la existente:
// carta-meta.js ya está desplegada y probada, y cualquier cambio ahí
// arriesga regresarla — más seguro duplicar esta lógica pequeña que tocar
// algo que ya funciona en producción.
//
// Diferencias con carta-meta.js: el título es solo el nombre del
// restaurante (sin " — Menú"), la descripción usa el eslogan de marca si
// existe, y la imagen es marca.portadaUrl (la foto de fondo configurada en
// Admin), no la foto de un plato.

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const SITE_URL = process.env.VITE_BASE_URL || 'https://mesadigital-pi.vercel.app';

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function obtenerRestaurante(restauranteId) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(`${base}/restaurantes/${encodeURIComponent(restauranteId)}`);
  if (!resp.ok) return null;
  const json = await resp.json();
  const nombre = json.fields?.nombre?.stringValue;
  if (!nombre) return null;
  const marca = json.fields?.marca?.mapValue?.fields || {};
  return {
    nombre,
    eslogan: marca.eslogan?.stringValue || null,
    portadaUrl: marca.portadaUrl?.stringValue || null,
  };
}

function renderHtml({ nombre, eslogan, portadaUrl, restauranteId }) {
  const nombreSeguro = escaparHtml(nombre);
  const descripcion = escaparHtml(eslogan || nombre);
  const url = `${SITE_URL}/restaurante/${encodeURIComponent(restauranteId)}`;

  const imagenTag = portadaUrl
    ? `<meta property="og:image" content="${escaparHtml(portadaUrl)}">\n    <meta name="twitter:card" content="summary_large_image">`
    : `<meta name="twitter:card" content="summary">`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <title>${nombreSeguro}</title>
    <meta name="description" content="${descripcion}">
    <meta property="og:title" content="${nombreSeguro}">
    <meta property="og:description" content="${descripcion}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    ${imagenTag}
  </head>
  <body>
    <a href="${url}">${nombreSeguro}</a>
  </body>
</html>`;
}

function renderHtmlGenerico(restauranteId) {
  const url = `${SITE_URL}/restaurante/${encodeURIComponent(restauranteId || '')}`;
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <title>MesaDigital</title>
    <meta name="description" content="Menú digital del restaurante.">
    <meta property="og:title" content="MesaDigital">
    <meta property="og:description" content="Menú digital del restaurante.">
    <meta property="og:type" content="website">
  </head>
  <body>
    <a href="${url}">Ver el restaurante</a>
  </body>
</html>`;
}

export default async function handler(req, res) {
  const restauranteId = typeof req.query.restauranteId === 'string' ? req.query.restauranteId : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');

  try {
    if (!restauranteId || !PROJECT_ID) {
      res.status(200).send(renderHtmlGenerico(restauranteId));
      return;
    }
    const datos = await obtenerRestaurante(restauranteId);
    if (!datos) {
      res.status(200).send(renderHtmlGenerico(restauranteId));
      return;
    }
    res.status(200).send(renderHtml({ ...datos, restauranteId }));
  } catch (e) {
    console.error('portada-meta error:', e);
    res.status(200).send(renderHtmlGenerico(restauranteId));
  }
}
