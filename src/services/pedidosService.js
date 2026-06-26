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

// ─── Envío de pedido (Cloud Function + fallback directo) ──
export function enviarPedido(restauranteId, { mesa, carrito, total, nota, clienteUid }) {
  const itemsAgrupados = carrito.reduce((acc, item) => {
    const e = acc.find((i) => i.id === item.id);
    if (e) e.cantidad += 1;
    else acc.push({ id: item.id, cantidad: 1 });
    return acc;
  }, []);

  async function tentarEnvio() {
    try {
      await getCrearPedidoFn()({ restauranteId, mesa, items: itemsAgrupados, nota, clienteUid });
    } catch (cfErr) {
      const cfCode = cfErr?.code || '';
      const notDeployed =
        cfCode.includes('not-found') ||
        cfCode.includes('unavailable') ||
        cfCode.includes('internal');
      if (!notDeployed) throw cfErr;

      return pedidosRepo.crearPedidoDirecto(restauranteId, { mesa, carrito, total, nota, clienteUid });
    }
  }

  return withBackoff(tentarEnvio);
}

// ─── Llamada al mesero ────────────────────────────────────
export function llamarMesero(restauranteId, mesa, clienteUid) {
  return withBackoff(() => pedidosRepo.crearLlamadaMesero(restauranteId, mesa, clienteUid));
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

export const subscribePedidosPorMesa = (restauranteId, numeroMesa, cb, onError) =>
  pedidosRepo.subscribePedidosPorMesa(restauranteId, numeroMesa, cb, onError);

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
  return 'Error al enviar el pedido. Intenta de nuevo.';
}
