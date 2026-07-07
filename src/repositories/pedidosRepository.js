import {
  collection, doc, query, where, orderBy, limit, Timestamp,
  onSnapshot, getDocs, writeBatch, serverTimestamp, increment, enableNetwork,
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
export function crearPedidoDirecto(restauranteId, { mesa, carrito, total, nota, clienteUid, idempotencyKey, mesaToken }) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, 'restaurantes', restauranteId, 'pedidos'));
  batch.set(ref, {
    mesa,
    items: carrito.map((p) => ({ nombre: p.nombre, precio: p.precio, tiempoMin: p.tiempoMin || 0 })),
    total,
    estado: 'pendiente',
    nota: nota.slice(0, 500),
    creadoEn: serverTimestamp(),
    clienteUid: clienteUid || null,
    idempotencyKey: idempotencyKey || null,
    mesaToken: mesaToken || null,
  });
  return batch.commit();
}

export function actualizarEstadoPedidos(restauranteId, ids, estado) {
  const batch = writeBatch(db);
  ids.forEach((id) =>
    batch.update(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado })
  );
  if (estado === 'archivado') {
    batch.update(doc(db, 'restaurantes', restauranteId), {
      'stats.mesasPendientes': increment(-1),
    });
  }
  return batch.commit();
}
