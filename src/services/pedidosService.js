import {
  collection, doc, writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';
import { getApps } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

// Only retry on transient/network errors — not on validation errors from the function
const RETRYABLE = ['unavailable', 'deadline-exceeded', 'resource-exhausted'];
const BACKOFF_MS = [1000, 2000, 4000];

async function withBackoff(fn) {
  let lastErr;
  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const code = e?.code || '';
      const isRetryable = RETRYABLE.some(c => code.includes(c));
      if (!isRetryable || i >= BACKOFF_MS.length) throw e;
      await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
    }
  }
  throw lastErr;
}

let _crearPedidoFn = null;
function getCrearPedidoFn() {
  if (!_crearPedidoFn) {
    _crearPedidoFn = httpsCallable(getFunctions(getApps()[0]), 'crearPedido');
  }
  return _crearPedidoFn;
}

export async function enviarPedido(restauranteId, { mesa, carrito, total, nota, clienteUid }) {
  // Compact carrito into {id, cantidad} pairs for the Cloud Function.
  // The server re-fetches real prices — the client never dictates cost.
  const itemsAgrupados = carrito.reduce((acc, item) => {
    const e = acc.find(i => i.id === item.id);
    if (e) e.cantidad += 1;
    else acc.push({ id: item.id, cantidad: 1 });
    return acc;
  }, []);

  async function tentarEnvio() {
    try {
      // Cloud Function path: server validates prices
      await getCrearPedidoFn()({ restauranteId, mesa, items: itemsAgrupados, nota, clienteUid });
    } catch (cfErr) {
      const cfCode = cfErr?.code || '';
      // If the function isn't deployed or unreachable, fall back to direct write.
      // Any other error (validation, not-found, etc.) is re-thrown immediately.
      const notDeployed =
        cfCode.includes('not-found') ||
        cfCode.includes('unavailable') ||
        cfCode.includes('internal');
      if (!notDeployed) throw cfErr;

      // Fallback: direct Firestore write (no server-side price validation).
      // Prices come from the client — acceptable only until Cloud Functions are deployed.
      const pedidoRef = doc(collection(db, 'restaurantes', restauranteId, 'pedidos'));
      const batch = writeBatch(db);
      batch.set(pedidoRef, {
        mesa,
        items: carrito.map(p => ({ nombre: p.nombre, precio: p.precio, tiempoMin: p.tiempoMin || 0 })),
        total,
        estado: 'pendiente',
        nota: nota.slice(0, 500),
        creadoEn: serverTimestamp(),
        clienteUid: clienteUid || null,
      });
      return batch.commit();
    }
  }

  return withBackoff(tentarEnvio);
}

export function llamarMesero(restauranteId, mesa, clienteUid) {
  return withBackoff(() => {
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
  });
}

export function actualizarEstadoMesa(restauranteId, ids, estado) {
  const batch = writeBatch(db);
  ids.forEach(id =>
    batch.update(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado })
  );
  // Decrement the active-mesa counter when a mesa is fully archived.
  // Clamped to >= 0 in the UI. The counter is incremented by the Cloud Function on create.
  if (estado === 'archivado') {
    batch.update(doc(db, 'restaurantes', restauranteId), {
      'stats.mesasPendientes': increment(-1),
    });
  }
  return batch.commit();
}
