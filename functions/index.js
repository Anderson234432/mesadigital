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
exports.crearPedido = onCall({ region: 'us-central1', timeoutSeconds: 30, minInstances: 1, enforceAppCheck: true }, async (request) => {
  const { restauranteId, mesa, items, nota, clienteUid, idempotencyKey, token } = request.data;

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

  // ── Token de mesa: si el restaurante usa mesaTokens, debe coincidir ─────────
  // Restaurantes sin mesaTokens (sistema no configurado) siguen funcionando
  // sin token, para no romper compatibilidad hacia atrás. mesaTokens vive en
  // _privado/mesaTokens (no en el documento raíz, que tiene lectura pública) —
  // ver firestore.rules.
  const privadoSnap = await db.doc(`restaurantes/${restauranteId}/_privado/mesaTokens`).get();
  const mesaTokens = privadoSnap.data()?.mesaTokens;
  if (mesaTokens && mesaTokens[mesaStr] !== token) {
    throw new HttpsError('permission-denied', 'Token de mesa inválido.');
  }

  // ── Fetch verified prices from server (fuera de la transacción: no necesita
  // atomicidad con lo demás, y evita cargar la transacción con hasta 30 reads) ──
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

  // ── Idempotencia + rate limiting (UID y mesa) + escritura: todo en una sola
  // transacción. Un check-then-write separado (como antes) deja una ventana
  // donde dos requests concurrentes leen el mismo estado "aún no existe / aún
  // no llegó al límite" antes de que ninguno escriba, y ambos pasan. La
  // transacción serializa esto: Firestore reintenta automáticamente si detecta
  // que otro request tocó los mismos documentos mientras esta corría.
  // request.auth?.uid viene del token verificado por Firebase; clienteUid es
  // dato del cliente y no debe tener prioridad, o el rate limit por UID se
  // evade mandando un clienteUid distinto en cada request.
  const uidKey = request.auth?.uid || clienteUid;
  const idempotencyQuery = (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.length <= 64)
    ? db.collection(`restaurantes/${restauranteId}/pedidos`).where('idempotencyKey', '==', idempotencyKey).limit(1)
    : null;
  const uidLimitRef = uidKey ? db.doc(`restaurantes/${restauranteId}/_ratelimits/${uidKey}`) : null;
  const mesaLimitRef = db.doc(`restaurantes/${restauranteId}/_ratelimits/mesa_${mesaStr}`);
  const existingPendienteQuery = db
    .collection(`restaurantes/${restauranteId}/pedidos`)
    .where('mesa', '==', mesaStr)
    .where('estado', '==', 'pendiente')
    .limit(1);

  const resultado = await db.runTransaction(async (tx) => {
    // ── Todas las lecturas primero (requisito de las transacciones de Firestore) ──
    const [idemSnap, uidLimitSnap, mesaLimitSnap, existingPendienteSnap] = await Promise.all([
      idempotencyQuery ? tx.get(idempotencyQuery) : Promise.resolve(null),
      uidLimitRef ? tx.get(uidLimitRef) : Promise.resolve(null),
      tx.get(mesaLimitRef),
      tx.get(existingPendienteQuery),
    ]);

    if (idemSnap && !idemSnap.empty) {
      const d = idemSnap.docs[0];
      return { pedidoId: d.id, total: d.data().total };
    }

    const now = Date.now();
    const windowMs = 60_000;

    // Rate limit por UID: máx 5 pedidos / 60s
    if (uidLimitRef) {
      if (uidLimitSnap.exists) {
        const { count, windowStart } = uidLimitSnap.data();
        if (now - windowStart < windowMs) {
          if (count >= 5) {
            throw new HttpsError('resource-exhausted', 'Demasiados pedidos. Espera un momento antes de volver a pedir.');
          }
          tx.update(uidLimitRef, { count: FieldValue.increment(1) });
        } else {
          tx.set(uidLimitRef, { count: 1, windowStart: now });
        }
      } else {
        tx.set(uidLimitRef, { count: 1, windowStart: now });
      }
    }

    // Rate limit por mesa: máx 10 pedidos / 60s (complementa el de UID, que se
    // evade re-autenticándose anónimo)
    if (mesaLimitSnap.exists) {
      const { count, windowStart } = mesaLimitSnap.data();
      if (now - windowStart < windowMs) {
        if (count >= 10) {
          throw new HttpsError('resource-exhausted', 'Demasiados pedidos desde esta mesa. Espera un momento.');
        }
        tx.update(mesaLimitRef, { count: FieldValue.increment(1) });
      } else {
        tx.set(mesaLimitRef, { count: 1, windowStart: now });
      }
    } else {
      tx.set(mesaLimitRef, { count: 1, windowStart: now });
    }

    const isNewMesa = existingPendienteSnap.empty;
    const nuevoPedidoRef = db.collection(`restaurantes/${restauranteId}/pedidos`).doc();
    tx.set(nuevoPedidoRef, {
      mesa: mesaStr,
      items: itemsValidados,
      total,
      estado: 'pendiente',
      nota: (nota || '').slice(0, 500),
      creadoEn: FieldValue.serverTimestamp(),
      clienteUid: request.auth?.uid || clienteUid || null,
      idempotencyKey: (idempotencyKey && typeof idempotencyKey === 'string') ? idempotencyKey : null,
    });

    if (isNewMesa) {
      tx.update(db.doc(`restaurantes/${restauranteId}`), {
        'stats.mesasPendientes': FieldValue.increment(1),
      });
    }

    return { pedidoId: nuevoPedidoRef.id, total };
  });

  return resultado;
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
