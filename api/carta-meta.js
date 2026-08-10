// Vercel Serverless Function — SOLO para bots de redes sociales/buscadores.
//
// Por qué existe: MesaDigital es una SPA (Vite + React Router), y los bots
// que generan la vista previa al pegar un link (WhatsApp, Facebook,
// Twitter/X, Google) NO ejecutan JavaScript — así que cualquier meta tag que
// Carta.jsx ponga con document.head.appendChild() (ver src/components/
// Carta.jsx) es invisible para ellos. Migrar a Next.js resolvería esto de
// raíz, pero es un cambio de arquitectura completo, fuera de alcance.
//
// La solución sin migrar: vercel.json reescribe /restaurante/:id/carta hacia
// ESTA función SOLO cuando el header User-Agent coincide con un bot conocido
// (ver la condición `has` del rewrite) — un navegador normal nunca la toca,
// sigue yendo a la SPA de siempre. Esta función lee el restaurante
// directamente de la API REST de Firestore (misma lectura pública que ya
// permiten firestore.rules — sin necesitar Admin SDK ni credenciales) y
// devuelve un HTML mínimo con los meta tags correctos. No es la carta
// real — es solo lo que el bot necesita para generar la vista previa; un
// humano que por error llegara aquí (no debería, el rewrite exige el
// User-Agent de un bot) ve un enlace a la carta de verdad.
//
// Nunca debe romper la vista previa de un restaurante por un error de red o
// de datos — cualquier fallo cae a una versión genérica de MesaDigital en
// vez de un 500.

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const SITE_URL = process.env.VITE_BASE_URL || 'https://mesadigital-pi.vercel.app';

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function obtenerRestauranteYPlatoConFoto(restauranteId) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  const restResp = await fetch(`${base}/restaurantes/${encodeURIComponent(restauranteId)}`);
  if (!restResp.ok) return null; // 404 u otro error — restaurante no existe o no se pudo leer
  const restJson = await restResp.json();
  const nombre = restJson.fields?.nombre?.stringValue;
  if (!nombre) return null;

  let imagenUrl = null;
  try {
    const platosResp = await fetch(`${base}/restaurantes/${encodeURIComponent(restauranteId)}/platos?pageSize=20`);
    if (platosResp.ok) {
      const platosJson = await platosResp.json();
      const conFoto = (platosJson.documents || []).find((d) => d.fields?.imagenUrl?.stringValue);
      imagenUrl = conFoto?.fields?.imagenUrl?.stringValue || null;
    }
  } catch {
    // Sin imagen de plato disponible — se sirve sin og:image, no es crítico.
  }

  return { nombre, imagenUrl };
}

function renderHtml({ nombre, imagenUrl, restauranteId }) {
  const nombreSeguro = escaparHtml(nombre);
  const titulo = `${nombreSeguro} — Menú`;
  const descripcion = `Menú de ${nombreSeguro}: platos, fotos y precios.`;
  const url = `${SITE_URL}/restaurante/${encodeURIComponent(restauranteId)}/carta`;

  // Sin foto de ningún plato: se omite og:image por completo en vez de
  // apuntar a un color sólido — un SVG placeholder no se renderiza de forma
  // confiable como imagen de vista previa en Facebook/WhatsApp, y es mejor
  // no tener imagen que tener una que no carga.
  const imagenTag = imagenUrl
    ? `<meta property="og:image" content="${escaparHtml(imagenUrl)}">\n    <meta name="twitter:card" content="summary_large_image">`
    : `<meta name="twitter:card" content="summary">`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <title>${titulo}</title>
    <meta name="description" content="${descripcion}">
    <meta property="og:title" content="${titulo}">
    <meta property="og:description" content="${descripcion}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    ${imagenTag}
  </head>
  <body>
    <a href="${url}">Ver el menú de ${nombreSeguro}</a>
  </body>
</html>`;
}

function renderHtmlGenerico(restauranteId) {
  const url = `${SITE_URL}/restaurante/${encodeURIComponent(restauranteId || '')}/carta`;
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <title>MesaDigital — Menú</title>
    <meta name="description" content="Menú digital del restaurante.">
    <meta property="og:title" content="MesaDigital — Menú">
    <meta property="og:description" content="Menú digital del restaurante.">
    <meta property="og:type" content="website">
  </head>
  <body>
    <a href="${url}">Ver el menú</a>
  </body>
</html>`;
}

export default async function handler(req, res) {
  const restauranteId = typeof req.query.restauranteId === 'string' ? req.query.restauranteId : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cache corto en el borde: los bots piden esto una sola vez por link
  // compartido, no hace falta recalcular en cada request, pero tampoco
  // conviene servir un menú desactualizado por días.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');

  try {
    if (!restauranteId || !PROJECT_ID) {
      res.status(200).send(renderHtmlGenerico(restauranteId));
      return;
    }
    const datos = await obtenerRestauranteYPlatoConFoto(restauranteId);
    if (!datos) {
      res.status(200).send(renderHtmlGenerico(restauranteId));
      return;
    }
    res.status(200).send(renderHtml({ ...datos, restauranteId }));
  } catch (e) {
    console.error('carta-meta error:', e);
    res.status(200).send(renderHtmlGenerico(restauranteId));
  }
}
