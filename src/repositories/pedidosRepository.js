import {
  collection, doc, query, where, orderBy, limit, Timestamp, documentId,
  onSnapshot, getDocs, writeBatch, serverTimestamp, increment, enableNetwork,
  runTransaction, updateDoc,
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

export async function actualizarEstadoPedidos(restauranteId, ids, estado) {
  if (estado !== 'archivado') {
    const batch = writeBatch(db);
    ids.forEach((id) =>
      batch.update(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado })
    );
    return batch.commit();
  }

  // Un doble tap/clic (común en móvil) puede disparar esta función dos veces
  // para la misma mesa antes de que el listener refleje el cambio; con un
  // batch simple eso decrementa dos veces y deja el contador negativo
  // permanentemente. La transacción de abajo solo decide decrementar si algún
  // PEDIDO REAL de esta tanda todavía no estaba archivado — esa DECISIÓN sí
  // necesita la foto consistente que da una transacción (lee estos mismos
  // `refs` y escribe su `estado` ahí mismo, así un doble clic concurrente
  // sobre los MISMOS pedidos se sigue serializando correctamente). Se
  // excluyen los de tipo 'llamada' a propósito: crearLlamadaMesero nunca
  // incrementa este contador (llamar al mesero no es un pedido), así que
  // descartar una llamada (Cocina.jsx: descartarLlamada) no debe decrementarlo
  // — antes de ese fix, archivar SOLO el documento de la llamada (que sigue
  // 'pendiente' hasta ese momento) igual disparaba el decremento, restando 1 de
  // stats.mesasPendientes cada vez que se atendía una llamada al mesero, sin
  // que nada lo hubiera incrementado — el contador quedaba cada vez más
  // negativo (enmascarado en pantalla por el Math.max(0, ...) de Menu.jsx, pero
  // el valor real en Firestore seguía cayendo).
  //
  // La ESCRITURA del contador (a diferencia de la decisión) se hace fuera de
  // esta transacción, después de que confirma — mismo motivo que en
  // functions/index.js/crearPedido: bajo carga, muchos archivados/pedidos de
  // mesas distintas escribiendo el mismo campo del mismo documento del
  // restaurante DENTRO de una transacción chocan entre sí
  // ("cross-transaction contention"). El contador es cosmético (solo el
  // tiempo estimado que ve el cliente); si esta actualización falla, el
  // archivado ya se aplicó igual — se registra el error y se sigue.
  const refs = ids.map((id) => doc(db, 'restaurantes', restauranteId, 'pedidos', id));
  const habiaActivos = await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const activos = snaps.some((s) =>
      s.exists() && s.data().estado !== 'archivado' && s.data().tipo !== 'llamada'
    );
    refs.forEach((ref) => tx.update(ref, { estado }));
    return activos;
  });

  if (habiaActivos) {
    try {
      await updateDoc(doc(db, 'restaurantes', restauranteId), {
        'stats.mesasPendientes': increment(-1),
      });
    } catch (e) {
      console.error('No se pudo actualizar stats.mesasPendientes (no crítico, el archivado ya se aplicó):', e);
    }
  }
}
