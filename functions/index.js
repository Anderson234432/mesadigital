const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

/**
 * crearPedido — callable Cloud Function.
 *
 * Receives { restauranteId, mesa, items: [{id, cantidad}], nota, clienteUid }.
 * Fetches real prices from Firestore, computes the server-side total,
 * and writes the verified pedido. The client NEVER sends prices.
 */
exports.crearPedido = onCall({ region: 'us-central1' }, async (request) => {
  const { restauranteId, mesa, items, nota, clienteUid } = request.data;

  // ── Input validation ────────────────────────────────────────────────────────
  if (!restauranteId || typeof restauranteId !== 'string') {
    throw new HttpsError('invalid-argument', 'restauranteId inválido.');
  }
  if (!mesa || typeof mesa !== 'string' || mesa.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Mesa inválida.');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    throw new HttpsError('invalid-argument', 'Items del pedido inválidos (máx 30).');
  }

  const mesaStr = mesa.trim().slice(0, 20);

  // ── Fetch verified prices from server ──────────────────────────────────────
  const platoSnaps = await Promise.all(
    items.map(item => db.doc(`restaurantes/${restauranteId}/platos/${item.id}`).get())
  );

  const itemsValidados = [];
  let total = 0;

  for (let i = 0; i < items.length; i++) {
    const snap = platoSnaps[i];
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Un plato del pedido ya no existe.');
    }
    const plato = snap.data();
    if (plato.disponible === false) {
      throw new HttpsError('failed-precondition', `"${plato.nombre}" no está disponible.`);
    }
    const cantidad = Math.max(1, Math.floor(Number(items[i].cantidad) || 1));
    for (let j = 0; j < cantidad; j++) {
      itemsValidados.push({
        nombre: plato.nombre,
        precio: plato.precio,   // server price — cannot be spoofed
        tiempoMin: plato.tiempoMin || 0,
      });
      total += plato.precio;
    }
  }

  // ── Check if this is a new active mesa (for stats counter accuracy) ─────────
  const existingPendiente = await db
    .collection(`restaurantes/${restauranteId}/pedidos`)
    .where('mesa', '==', mesaStr)
    .where('estado', '==', 'pendiente')
    .limit(1)
    .get();

  const isNewMesa = existingPendiente.empty;

  // ── Atomic batch write ──────────────────────────────────────────────────────
  const batch = db.batch();

  const nuevoPedidoRef = db.collection(`restaurantes/${restauranteId}/pedidos`).doc();
  batch.set(nuevoPedidoRef, {
    mesa: mesaStr,
    items: itemsValidados,
    total,
    estado: 'pendiente',
    nota: (nota || '').slice(0, 500),
    creadoEn: FieldValue.serverTimestamp(),
    clienteUid: clienteUid || request.auth?.uid || null,
  });

  if (isNewMesa) {
    batch.update(db.doc(`restaurantes/${restauranteId}`), {
      'stats.mesasPendientes': FieldValue.increment(1),
    });
  }

  await batch.commit();

  return { pedidoId: nuevoPedidoRef.id, total };
});
