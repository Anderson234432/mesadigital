import {
  collection, doc, query, where, orderBy, limit, Timestamp, documentId,
  onSnapshot, getDocs, writeBatch, serverTimestamp, increment, enableNetwork,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase';

export const reconectarFirestore = () => enableNetwork(db);

export const getPedidosPorUid = (restauranteId, clienteUid) =>
  getDocs(query(
    collection(db, 'restaurantes', restauranteId, 'pedidos'),
    where('clienteUid', '==', clienteUid)
  )).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));

export const subscribePedidosFecha = (restauranteId, inicioDia, finDia, onChange, onError, limitN = 0) =>
  onSnapshot(
    query(
      collection(db, 'restaurantes', restauranteId, 'pedidos'),
      where('creadoEn', '>=', Timestamp.fromDate(inicioDia)),
      where('creadoEn', '<=', Timestamp.fromDate(finDia)),
      orderBy('creadoEn', 'desc'),
      ...(limitN > 0 ? [limit(limitN)] : [])
    ),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export const subscribePedidosDesde = (restauranteId, desde, onChange, onError) =>
  onSnapshot(
    query(
      collection(db, 'restaurantes', restauranteId, 'pedidos'),
      where('creadoEn', '>=', Timestamp.fromDate(desde))
    ),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export const subscribePedidosPorUid = (restauranteId, clienteUid, onChange, onError) =>
  onSnapshot(
    query(
      collection(db, 'restaurantes', restauranteId, 'pedidos'),
      where('clienteUid', '==', clienteUid)
    ),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export function crearLlamadaMesero(restauranteId, mesa, clienteUid, mesaToken) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, 'restaurantes', restauranteId, 'pedidos'));
  batch.set(ref, {
    mesa,
    items: [],
    total: 0,
    estado: 'pendiente',
    tipo: 'llamada',
    nota: '🔔 Mesa solicita atención',
    creadoEn: serverTimestamp(),
    clienteUid: clienteUid || null,
    mesaToken: mesaToken || null,
  });
  return batch.commit();
}

// Fallback de emergencia: solo se usa si la Cloud Function crearPedido no
// responde (ver pedidosService.js). Escribe el total y los precios de items[]
// tal como los tiene el cliente en memoria — NO los coteja contra platos/,
// a diferencia de la Cloud Function, que sí recalcula el precio server-side.
// Las Rules de Firestore (allow create de pedidos) son la única validación de
// precio en este camino: solo acotan el rango, no verifican precio real.
export async function crearPedidoDirecto(restauranteId, { mesa, carrito, subtotal, itbis, propina, total, nota, clienteUid, idempotencyKey, mesaToken }) {
  const pedidosRef = collection(db, 'restaurantes', restauranteId, 'pedidos');

  // isNewMesa: misma condición que la Cloud Function (mesa == mesa, estado ==
  // 'pendiente'). Solo si no hay ya un pedido pendiente en esta mesa se
  // incrementa stats.mesasPendientes — evita contar la misma mesa dos veces
  // cuando el cliente envía una segunda ronda.
  const existingPendienteSnap = await getDocs(
    query(pedidosRef, where('mesa', '==', mesa), where('estado', '==', 'pendiente'), limit(1))
  );
  const isNewMesa = existingPendienteSnap.empty;

  const batch = writeBatch(db);
  const ref = doc(pedidosRef);
  batch.set(ref, {
    mesa,
    items: carrito.map((p) => ({ nombre: p.nombre, nombreEn: p.nombreEn || null, precio: p.precio, tiempoMin: p.tiempoMin || 0, platoId: p.id })),
    subtotal,
    itbis,
    propina,
    total,
    estado: 'pendiente',
    nota: nota.slice(0, 500),
    creadoEn: serverTimestamp(),
    clienteUid: clienteUid || null,
    idempotencyKey: idempotencyKey || null,
    mesaToken: mesaToken || null,
  });
  if (isNewMesa) {
    batch.update(doc(db, 'restaurantes', restauranteId), {
      'stats.mesasPendientes': increment(1),
    });
  }
  return batch.commit();
}

// ── Ventas diarias agregadas (escritas solo por la Cloud Function crearPedido) ──
// Rango por ID de documento (YYYY-MM-DD ordena igual lexicográfica y
// cronológicamente) — a lo sumo ~31 lecturas por mes, sin índice compuesto.
export const subscribeVentasDiarias = (restauranteId, fechaInicioStr, fechaFinStr, onChange, onError) =>
  onSnapshot(
    query(
      collection(db, 'restaurantes', restauranteId, 'ventasDiarias'),
      where(documentId(), '>=', fechaInicioStr),
      where(documentId(), '<=', fechaFinStr)
    ),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export function actualizarEstadoPedidos(restauranteId, ids, estado) {
  if (estado !== 'archivado') {
    const batch = writeBatch(db);
    ids.forEach((id) =>
      batch.update(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado })
    );
    return batch.commit();
  }

  // Archivar decrementa stats.mesasPendientes. Un doble tap/clic (común en
  // móvil) puede disparar esta función dos veces para la misma mesa antes de
  // que el listener refleje el cambio; con un batch simple eso decrementa dos
  // veces y deja el contador negativo permanentemente. La transacción solo
  // decrementa si algún PEDIDO REAL de esta tanda todavía no estaba
  // archivado. Se excluyen los de tipo 'llamada' a propósito: crearLlamadaMesero
  // nunca incrementa este contador (llamar al mesero no es un pedido), así que
  // descartar una llamada (Cocina.jsx: descartarLlamada) no debe decrementarlo
  // — antes de este fix, archivar SOLO el documento de la llamada (que sigue
  // 'pendiente' hasta ese momento) igual disparaba el decremento, restando 1 de
  // stats.mesasPendientes cada vez que se atendía una llamada al mesero, sin
  // que nada lo hubiera incrementado — el contador quedaba cada vez más
  // negativo (enmascarado en pantalla por el Math.max(0, ...) de Menu.jsx, pero
  // el valor real en Firestore seguía cayendo).
  const refs = ids.map((id) => doc(db, 'restaurantes', restauranteId, 'pedidos', id));
  return runTransaction(db, async (tx) => {
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const habiaActivos = snaps.some((s) =>
      s.exists() && s.data().estado !== 'archivado' && s.data().tipo !== 'llamada'
    );
    refs.forEach((ref) => tx.update(ref, { estado }));
    if (habiaActivos) {
      tx.update(doc(db, 'restaurantes', restauranteId), {
        'stats.mesasPendientes': increment(-1),
      });
    }
  });
}
