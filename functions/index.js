const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();

/**
 * crearPedido — callable Cloud Function.
 *
 * Receives { restauranteId, mesa, items: [{id, cantidad}], nota, clienteUid }.
 * Fetches real prices from Firestore, computes the server-side total,
 * and writes the verified pedido. The client NEVER sends prices.
 */
exports.crearPedido = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const { restauranteId, mesa, items, nota, clienteUid, idempotencyKey } = request.data;

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

  // ── Idempotency: si este UUID ya procesó un pedido, devolver el existente ───
  if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.length <= 64) {
    const existing = await db
      .collection(`restaurantes/${restauranteId}/pedidos`)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existing.empty) {
      const d = existing.docs[0];
      return { pedidoId: d.id, total: d.data().total };
    }
  }

  // ── Rate limiting: máx 5 pedidos por 60 s por UID ──────────────────────────
  const uidKey = clienteUid || request.auth?.uid;
  if (uidKey) {
    const limitRef = db.doc(`restaurantes/${restauranteId}/_ratelimits/${uidKey}`);
    const limitSnap = await limitRef.get();
    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = 5;

    if (limitSnap.exists) {
      const { count, windowStart } = limitSnap.data();
      if (now - windowStart < windowMs) {
        if (count >= maxRequests) {
          throw new HttpsError('resource-exhausted', 'Demasiados pedidos. Espera un momento antes de volver a pedir.');
        }
        await limitRef.update({ count: FieldValue.increment(1) });
      } else {
        await limitRef.set({ count: 1, windowStart: now });
      }
    } else {
      await limitRef.set({ count: 1, windowStart: now });
    }
  }

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
    idempotencyKey: (idempotencyKey && typeof idempotencyKey === 'string') ? idempotencyKey : null,
  });

  if (isNewMesa) {
    batch.update(db.doc(`restaurantes/${restauranteId}`), {
      'stats.mesasPendientes': FieldValue.increment(1),
    });
  }

  await batch.commit();

  return { pedidoId: nuevoPedidoRef.id, total };
});

// ── Limpieza semanal de usuarios anónimos (>30 días sin actividad) ─────────
exports.limpiarUsuariosAnonimos = onSchedule(
  { schedule: 'every 168 hours', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    const auth = getAuth();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let pageToken;
    let deleted = 0;

    do {
      const listResult = await auth.listUsers(1000, pageToken);
      const uidsAEliminar = listResult.users
        .filter((u) =>
          u.providerData.length === 0 &&
          new Date(u.metadata.lastSignInTime).getTime() < cutoff
        )
        .map((u) => u.uid);

      if (uidsAEliminar.length > 0) {
        const deleteResult = await auth.deleteUsers(uidsAEliminar);
        deleted += deleteResult.successCount;
        if (deleteResult.failureCount > 0) {
          deleteResult.errors.forEach((e) =>
            console.error(`Error borrando uid en posición ${e.index}:`, e.error.message)
          );
        }
      }
      pageToken = listResult.pageToken;
    } while (pageToken);

    console.log(`Usuarios anónimos eliminados: ${deleted}`);
  }
);

// ── Limpieza mensual de pedidos archivados (>30 días) ─────────────────────────
// Corre cada 24 horas, borra en lotes de 400 para no superar límites de Firestore.
// Solo toca pedidos con estado='archivado' y creadoEn > 30 días atrás.
exports.limpiarPedidosAntiguos = onSchedule(
  { schedule: 'every 24 hours', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const { Timestamp } = require('firebase-admin/firestore');
    const BATCH_SIZE = 400;

    const restaurantesSnap = await db.collection('restaurantes').get();
    let totalBorrados = 0;

    for (const restauranteDoc of restaurantesSnap.docs) {
      const restauranteId = restauranteDoc.id;
      let borradosEnEstRest = 0;

      // Paginar hasta no quedar pedidos viejos archivados
      let hayMas = true;
      while (hayMas) {
        const snap = await db
          .collection(`restaurantes/${restauranteId}/pedidos`)
          .where('estado', '==', 'archivado')
          .where('creadoEn', '<=', Timestamp.fromDate(cutoff))
          .limit(BATCH_SIZE)
          .get();

        if (snap.empty) { hayMas = false; break; }

        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        borradosEnEstRest += snap.size;
        if (snap.size < BATCH_SIZE) hayMas = false;
      }

      if (borradosEnEstRest > 0) {
        console.log(`[${restauranteId}] pedidos archivados eliminados: ${borradosEnEstRest}`);
        totalBorrados += borradosEnEstRest;
      }
    }

    console.log(`Limpieza completada. Total pedidos eliminados: ${totalBorrados}`);
  }
);
