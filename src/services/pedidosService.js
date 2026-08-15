import * as pedidosRepo from '../repositories/pedidosRepository';
import { getCrearPedidoFn } from '../repositories/functionsRepository';
import { rangoDiaOperativo, fechaOperativaHoy } from '../utils/fechaOperativa';

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

// ─── Envío de pedido (solo Cloud Function — sin fallback directo) ──
// Hasta 2026-08-15 existía un camino de respaldo (crearPedidoDirecto) que
// escribía el pedido directo a Firestore con los precios que el cliente
// tenía en memoria cuando crearPedido fallaba. Se eliminó tras medir uso
// real en producción: de 108 pedidos reales del único restaurante en
// producción, solo 5 (4.6%) se crearon por ese camino, y los 5 cayeron el
// mismo día — antes de que App Check quedara bien desplegado (commit
// cd378bb) — sin un solo caso más en las más de 3 semanas siguientes. A
// cambio, ese camino nunca verificaba precios contra platos/ (demostrado en
// vivo: un plato de RD$650 aceptado a RD$1) y no tenía ningún límite de
// frecuencia. Si crearPedido falla ahora, withBackoff ya reintenta lo
// razonable (errores de red/cuota) y si aun así no se puede enviar, el
// error sube tal cual a quien llama — Menu.jsx lo traduce con
// parsearErrorPedido en un mensaje claro y accionable.
export function enviarPedido(restauranteId, { mesa, carrito, nota, clienteUid, idempotencyKey }) {
  const itemsAgrupados = carrito.reduce((acc, item) => {
    const e = acc.find((i) => i.id === item.id);
    if (e) e.cantidad += 1;
    else acc.push({ id: item.id, cantidad: 1 });
    return acc;
  }, []);
  const token = leerTokenMesa(restauranteId, mesa);

  return withBackoff(() =>
    getCrearPedidoFn()({ restauranteId, mesa, items: itemsAgrupados, nota, clienteUid, idempotencyKey, token })
  );
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
// El rango [inicio, fin) de rangoDiaOperativo es exclusivo en `fin` —
// subscribePedidosFecha (Firestore) usa un límite superior inclusivo (<=),
// así que se resta 1ms para no incluir el primer instante del día siguiente.
export function subscribePedidosDia(restauranteId, fechaFiltro, horaCierreOperativo, cb) {
  const { inicio, fin } = rangoDiaOperativo(fechaFiltro, horaCierreOperativo);
  return pedidosRepo.subscribePedidosFecha(
    restauranteId, inicio, new Date(fin.getTime() - 1),
    cb,
    (err) => console.error('subscribePedidosDia:', err)
  );
}

// `inicio`/`fin` ya vienen como instantes exactos (día operativo) — ver
// Admin.jsx (rangoPeriodo). Mismo ajuste de -1ms que subscribePedidosDia.
export function subscribePedidosPeriodo(restauranteId, inicio, fin, cb) {
  return pedidosRepo.subscribePedidosFecha(
    restauranteId, inicio, new Date(fin.getTime() - 1),
    cb,
    (err) => console.error('subscribePedidosPeriodo:', err),
    500
  );
}

// Pedidos del día operativo ACTUAL, sin límite superior (cocina necesita ver
// pedidos según se van creando). Ancla el límite inferior al inicio del día
// operativo (no a la medianoche local) — así, si esta suscripción se rearma
// después de medianoche pero antes del cierre operativo (p.ej. al volver a
// primer plano en el celular), no pierde los pedidos de la mesa que sigue
// activa desde antes de medianoche.
export function subscribePedidosHoy(restauranteId, horaCierreOperativo, cb, onError) {
  const { inicio } = rangoDiaOperativo(fechaOperativaHoy(horaCierreOperativo), horaCierreOperativo);
  return pedidosRepo.subscribePedidosDesde(
    restauranteId, inicio,
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
  // Debe ir ANTES del failed-precondition genérico de abajo: ambos usan el
  // mismo código, y sin este chequeo específico primero, un rechazo por
  // restaurante cerrado (crearPedido, ver functions/index.js) caería en la
  // rama de "plato no disponible" — un mensaje confuso y equivocado.
  if (code.includes('failed-precondition') && msg.includes('cerrado')) {
    return e.message; // ya viene en español, específico (día/hora si aplica) — no se genericiza
  }
  if (code.includes('failed-precondition') || msg.includes('disponible')) {
    const match = e?.message?.match(/"([^"]+)"/);
    return match ? `"${match[1]}" ya no está disponible.` : 'Un plato ya no está disponible.';
  }
  if (code.includes('invalid-argument'))
    return 'Error en el pedido. Verifica tu selección e intenta de nuevo.';
  if (code.includes('permission-denied'))
    return 'Accede escaneando el código QR de tu mesa.';
  // Sin código conocido de la Cloud Function (red cortada, función no
  // disponible, error interno) — ya no hay camino de respaldo que lo
  // absorba en silencio (ver enviarPedido más arriba): el pedido de verdad
  // no se envió, hay que decírselo claro y con una salida real.
  return 'No pudimos enviar tu pedido. Llama al mesero o intenta de nuevo.';
}
