import {
  collection, doc, query, where, Timestamp,
  onSnapshot, writeBatch, increment,
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
