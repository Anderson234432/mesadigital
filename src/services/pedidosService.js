import * as pedidosRepo from '../repositories/pedidosRepository';
import { getCrearPedidoFn } from '../repositories/functionsRepository';

// ─── Retry logic ──────────────────────────────────────────
const RETRYABLE = ['unavailable', 'deadline-exceeded', 'resource-exhausted'];
const BACKOFF_MS = [1000, 2000, 4000];

async function withBackoff(fn) {
  let lastErr;
  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const code = e?.code || '';
      const isRetryable = RETRYABLE.some((c) => code.includes(c));
      if (!isRetryable || i >= BACKOFF_MS.length) throw e;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
    }
  }
  throw lastErr;
}

// ─── Reconexión y lectura puntual (polling móvil) ────────
export const reconectarFirestore = () => pedidosRepo.reconectarFirestore();

export function leerPedidosMesa(restauranteId, clienteUid) {
  if (!clienteUid) return Promise.resolve([]);
  return pedidosRepo.getPedidosPorUid(restauranteId, clienteUid);
}

// ─── Impuestos (ITBIS + propina legal) ────────────────────
// Misma fórmula que functions/index.js: ambos porcentajes se aplican sobre
// el subtotal (no en cascada), y cada componente se redondea por separado
// para que el desglose que ve el cliente coincida exactamente con lo que
// calcula la Cloud Function.
export function calcularImpuestos(subtotal, impuestos = {}) {
  const itbisPorcentaje = Number(impuestos.itbisPorcentaje) || 0;
  const propinaPorcentaje = Number(impuestos.propinaPorcentaje) || 0;
  const itbis = impuestos.itbisActivo ? Math.round(subtotal * itbisPorcentaje / 100) : 0;
  const propina = impuestos.propinaActivo ? Math.round(subtotal * propinaPorcentaje / 100) : 0;
  return { subtotal, itbis, propina, total: subtotal + itbis + propina };
}

// ─── Token de mesa (guardado por Menu.jsx al validar el QR) ──
// Se lee aquí en vez de recibirlo por parámetro para evitar prop drilling
// desde Menu.jsx a través de todas las llamadas de este servicio.
function leerTokenMesa(restauranteId, mesa) {
  try {
    return sessionStorage.getItem(`token_${restauranteId}_${mesa}`) || null;
  } catch {
    return null;
  }
}

// ─── Envío de pedido (Cloud Function + fallback directo) ──
// `total` recibido aquí es el subtotal del carrito (suma de precios de
// items, sin impuestos) — la CF lo recalcula desde platos/ de todos modos.
// `impuestos` es la config del restaurante (restaurante.impuestos, ya
// disponible en Menu.jsx vía subscribeRestaurante) — solo se usa en el
// fallback directo, ya que la CF lee su propia copia server-side.
export function enviarPedido(restauranteId, { mesa, carrito, total, nota, clienteUid, idempotencyKey, impuestos }) {
  const itemsAgrupados = carrito.reduce((acc, item) => {
    const e = acc.find((i) => i.id === item.id);
    if (e) e.cantidad += 1;
    else acc.push({ id: item.id, cantidad: 1 });
    return acc;
  }, []);
  const token = leerTokenMesa(restauranteId, mesa);

  async function tentarEnvio() {
    try {
      await getCrearPedidoFn()({ restauranteId, mesa, items: itemsAgrupados, nota, clienteUid, idempotencyKey, token });
    } catch (cfErr) {
      const cfCode = cfErr?.code || '';
      // 'unauthenticated' cubre el rechazo de App Check (p.ej. si el sitio no
      // tiene VITE_RECAPTCHA_SITE_KEY configurado): sin este caso, un fallo de
      // App Check tumba el pedido por completo en vez de usar el fallback.
      const notDeployed =
        cfCode.includes('not-found') ||
        cfCode.includes('unavailable') ||
        cfCode.includes('internal') ||
        cfCode.includes('unauthenticated');
      if (!notDeployed) throw cfErr;

      const desglose = calcularImpuestos(total, impuestos);
      return pedidosRepo.crearPedidoDirecto(restauranteId, { mesa, carrito, nota, clienteUid, idempotencyKey, mesaToken: token, ...desglose });
    }
  }

  return withBackoff(tentarEnvio);
}

// ─── Llamada al mesero ────────────────────────────────────
export function llamarMesero(restauranteId, mesa, clienteUid) {
  const token = leerTokenMesa(restauranteId, mesa);
  return withBackoff(() => pedidosRepo.crearLlamadaMesero(restauranteId, mesa, clienteUid, token));
}

// ─── Estado de mesas ──────────────────────────────────────
export const actualizarEstadoMesa = (restauranteId, ids, estado) =>
  pedidosRepo.actualizarEstadoPedidos(restauranteId, ids, estado);

// ─── Subscripciones ───────────────────────────────────────
export function subscribePedidosDia(restauranteId, fechaFiltro, cb) {
  const [y, m, d] = fechaFiltro.split('-').map(Number);
  const inicioDia = new Date(y, m - 1, d, 0, 0, 0, 0);
  const finDia = new Date(y, m - 1, d, 23, 59, 59, 999);
  return pedidosRepo.subscribePedidosFecha(
    restauranteId, inicioDia, finDia,
    cb,
    (err) => console.error('subscribePedidosDia:', err)
  );
}

export function subscribePedidosPeriodo(restauranteId, inicio, fin, cb) {
  return pedidosRepo.subscribePedidosFecha(
    restauranteId, inicio, fin,
    cb,
    (err) => console.error('subscribePedidosPeriodo:', err),
    500
  );
}

export function subscribePedidosHoy(restauranteId, cb, onError) {
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  return pedidosRepo.subscribePedidosDesde(
    restauranteId, inicioDia,
    cb,
    onError || ((err) => console.error('subscribePedidosHoy:', err))
  );
}

export const subscribePedidosPorUid = (restauranteId, clienteUid, cb, onError) =>
  pedidosRepo.subscribePedidosPorUid(restauranteId, clienteUid, cb, onError);

export function subscribeVentasDiarias(restauranteId, fechaInicioStr, fechaFinStr, cb) {
  return pedidosRepo.subscribeVentasDiarias(
    restauranteId, fechaInicioStr, fechaFinStr,
    cb,
    (err) => console.error('subscribeVentasDiarias:', err)
  );
}

// ─── Clasificación de errores ─────────────────────────────
export function parsearErrorPedido(e) {
  const code = (e?.code || '').toLowerCase();
  const msg = (e?.message || '').toLowerCase();
  if (code.includes('resource-exhausted') || msg.includes('demasiados'))
    return 'Demasiados pedidos seguidos. Espera un momento e intenta de nuevo.';
  if (code.includes('not-found') || msg.includes('no existe'))
    return 'Un plato ya no está en el menú. Recarga la página e intenta de nuevo.';
  if (code.includes('failed-precondition') || msg.includes('disponible')) {
    const match = e?.message?.match(/"([^"]+)"/);
    return match ? `"${match[1]}" ya no está disponible.` : 'Un plato ya no está disponible.';
  }
  if (code.includes('invalid-argument'))
    return 'Error en el pedido. Verifica tu selección e intenta de nuevo.';
  if (code.includes('permission-denied'))
    return 'Accede escaneando el código QR de tu mesa.';
  return 'Error al enviar el pedido. Intenta de nuevo.';
}
