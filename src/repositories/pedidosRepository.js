import {
  collection, doc, query, where, Timestamp,
  onSnapshot, writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../firebase';

export const subscribePedidosFecha = (restauranteId, inicioDia, finDia, onChange, onError) =>
  onSnapshot(
    query(
      collection(db, 'restaurantes', restauranteId, 'pedidos'),
      where('creadoEn', '>=', Timestamp.fromDate(inicioDia)),
      where('creadoEn', '<=', Timestamp.fromDate(finDia))
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

export const subscribePedidosPorMesa = (restauranteId, numeroMesa, onChange, onError) =>
  onSnapshot(
    query(
      collection(db, 'restaurantes', restauranteId, 'pedidos'),
      where('mesa', '==', numeroMesa)
    ),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export function crearLlamadaMesero(restauranteId, mesa, clienteUid) {
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
  });
  return batch.commit();
}

export function crearPedidoDirecto(restauranteId, { mesa, carrito, total, nota, clienteUid }) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, 'restaurantes', restauranteId, 'pedidos'));
  batch.set(ref, {
    mesa,
    items: carrito.map((p) => ({ nombre: p.nombre, precio: p.precio, tiempoMin: p.tiempoMin || 0, nota: p.nota || '' })),
    total,
    estado: 'pendiente',
    nota: nota.slice(0, 500),
    creadoEn: serverTimestamp(),
    clienteUid: clienteUid || null,
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
