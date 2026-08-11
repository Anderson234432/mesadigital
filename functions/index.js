const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('node:crypto');
const { Resend } = require('resend');
const { fechaOperativa } = require('./lib/fechaOperativa');
const { puedeOrdenarAhora, calcularEstadoApertura, formatHora12 } = require('./lib/horarioRestaurante');

// Mismo texto que Menu.jsx le muestra al cliente (ver
// restauranteCerradoTitulo/restauranteAbre* en src/i18n.js) — se construye
// aparte aquí porque el error de una Cloud Function es un string plano, no
// puede devolver las piezas estructuradas que sí usa el cliente para su
// propia píldora de estado.
function mensajeRestauranteCerrado(horarios) {
  const estado = calcularEstadoApertura(horarios, Date.now());
  let cuando = '';
  if (estado?.categoria === 'abreHoy') {
    cuando = ` Abre hoy a las ${formatHora12(estado.horaAbre)}.`;
  } else if (estado && (estado.categoria === 'otroDia' || estado.categoria === 'cerradoHoy')) {
    cuando = estado.diasAdelante === 1
      ? ` Abre mañana a las ${formatHora12(estado.horaAbre)}.`
      : ` Abre el ${estado.nombreDiaApertura} a las ${formatHora12(estado.horaAbre)}.`;
  }
  return `El restaurante está cerrado en este momento.${cuando}`;
}

initializeApp();
const db = getFirestore();

const resendApiKey = defineSecret('RESEND_API_KEY');

// ── Validación compartida por enviarCodigoInvitacion y canjearInvitacion ──────
function validarInvitacionActiva(inv) {
  if (inv.revocada) {
    throw new HttpsError('failed-precondition', 'Esta invitación fue revocada.');
  }
  if (inv.usadaPor) {
    throw new HttpsError('failed-precondition', 'Esta invitación ya fue usada.');
  }
  if (!inv.expiraEn || inv.expiraEn.toMillis() < Date.now()) {
    throw new HttpsError('failed-precondition', 'Esta invitación venció.');
  }
  if (inv.rol !== 'admin' && inv.rol !== 'cocina') {
    throw new HttpsError('failed-precondition', 'Rol de invitación inválido.');
  }
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hashCodigo(codigo, salt) {
  return crypto.createHash('sha256').update(`${salt}:${codigo}`).digest('hex');
}

// Tablas, no flexbox — así se ve razonablemente bien en clientes de correo
// viejos (Outlook de escritorio, etc.). Sin imágenes externas.
function plantillaCorreoCodigo({ codigo, nombreRestaurante, rolLabel }) {
  const nombreSeguro = escaparHtml(nombreRestaurante);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#171717;border:1px solid #262626;">
      <tr><td style="padding:32px 40px;text-align:center;">
        <p style="color:#fbbf24;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 8px;font-family:Georgia,serif;">MesaDigital</p>
        <h1 style="color:#ffffff;font-size:20px;margin:0 0 24px;font-family:Georgia,serif;">Tu código de acceso</h1>
        <p style="color:#a3a3a3;font-size:14px;margin:0 0 24px;font-family:Georgia,serif;">
          Acceso de ${rolLabel} para <strong style="color:#ffffff;">${nombreSeguro}</strong>
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
          <tr><td style="background:#0a0a0a;border:1px solid #fbbf24;padding:16px 32px;">
            <span style="font-family:'Courier New',monospace;font-size:32px;letter-spacing:8px;color:#fbbf24;font-weight:bold;">${codigo}</span>
          </td></tr>
        </table>
        <p style="color:#737373;font-size:12px;margin:0;font-family:Georgia,serif;">Este código vence en 10 minutos.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}


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
  // Se rechaza '/' porque restauranteId y mesa se usan para construir paths de
  // Firestore (restaurantes/${restauranteId}/..., _ratelimits/mesa_${mesa});
  // un '/' desalinea los segmentos de la jerarquía de documentos.
  if (!restauranteId || typeof restauranteId !== 'string' || restauranteId.includes('/')) {
    throw new HttpsError('invalid-argument', 'restauranteId inválido.');
  }
  if (!mesa || typeof mesa !== 'string' || mesa.trim().length === 0 || mesa.includes('/')) {
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
  const [privadoSnap, restauranteSnap] = await Promise.all([
    db.doc(`restaurantes/${restauranteId}/_privado/mesaTokens`).get(),
    db.doc(`restaurantes/${restauranteId}`).get(),
  ]);
  // El camino de fallback (firestore.rules, allow create de pedidos) ya exige
  // restauranteExiste(restauranteId) — aquí faltaba el mismo chequeo. Sin él,
  // si el maestro elimina un restaurante mientras un cliente tiene el menú
  // abierto (eliminarRestaurante solo borra el documento raíz, no en cascada
  // pedidos/platos/_privado — ver restaurantesRepository.js), un pedido
  // enviado justo después se escribía igual vía Admin SDK en una subcolección
  // huérfana que nadie con acceso al panel puede ya leer, mostrándole al
  // cliente un "pedido enviado" exitoso que ninguna cocina real recibe.
  if (!restauranteSnap.exists) {
    throw new HttpsError('not-found', 'Este restaurante ya no existe.');
  }
  const mesaTokens = privadoSnap.data()?.mesaTokens;
  if (mesaTokens && mesaTokens[mesaStr] !== token) {
    throw new HttpsError('permission-denied', 'Token de mesa inválido.');
  }
  const impuestosConfig = restauranteSnap.data()?.impuestos || {};
  const horaCierreOperativo = restauranteSnap.data()?.horaCierreOperativo || '00:00';

  // ── Horario del restaurante: rechaza si está cerrado ────────────────────────
  // El deshabilitado del botón en Menu.jsx es solo para la experiencia de
  // usuario — cualquiera puede llamar esta función directo sin pasar por la
  // interfaz, así que la validación real vive aquí. Sin `horarios` configurado
  // no hay restricción (comportamiento idéntico al de antes). Incluye el mismo
  // margen de gracia de 15 min tras el cierre que usa Menu.jsx, para no
  // rechazar un pedido que llegó apenas unos segundos después de la hora
  // nominal de cierre.
  const horarios = restauranteSnap.data()?.horarios;
  if (!puedeOrdenarAhora(horarios, Date.now())) {
    throw new HttpsError('failed-precondition', mensajeRestauranteCerrado(horarios));
  }

  // ── Fetch verified prices from server (fuera de la transacción: no necesita
  // atomicidad con lo demás, y evita cargar la transacción con hasta 30 reads) ──
  const platoSnaps = await Promise.all(
    items.map(item => db.doc(`restaurantes/${restauranteId}/platos/${item.id}`).get())
  );

  const itemsValidados = [];
  let subtotal = 0;

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
        nombreEn: plato.nombreEn || null,
        precio: plato.precio,   // server price — cannot be spoofed
        tiempoMin: plato.tiempoMin || 0,
        platoId: items[i].id,  // clave estable para el ranking en ventasDiarias
      });
      subtotal += plato.precio;
    }
  }

  // ITBIS y propina legal se aplican sobre el subtotal, no en cascada (ITBIS
  // sobre subtotal, propina sobre subtotal — nunca propina sobre subtotal+ITBIS).
  // Misma fórmula que calcularImpuestos() en src/services/pedidosService.js,
  // para que el total coincida exactamente con lo que ve el cliente.
  const itbisPct = Number(impuestosConfig.itbisPorcentaje) || 0;
  const propinaPct = Number(impuestosConfig.propinaPorcentaje) || 0;
  const itbis = impuestosConfig.itbisActivo ? Math.round(subtotal * itbisPct / 100) : 0;
  const propina = impuestosConfig.propinaActivo ? Math.round(subtotal * propinaPct / 100) : 0;
  const total = subtotal + itbis + propina;

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
      subtotal,
      itbis,
      propina,
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

    // ── Agregación de ventas diarias ────────────────────────────────────────
    // Un documento por día (restaurantes/{id}/ventasDiarias/{YYYY-MM-DD}) con
    // totales y ranking de platos ya sumados, para que Admin.jsx no dependa de
    // leer todos los pedidos del período (eso es lo que causaba que semana/mes
    // se truncaran a 500 documentos y mintieran el total). Se agrupa por
    // platoId antes de escribir para no pisar el mismo campo dos veces dentro
    // de la misma transacción si el pedido repite un plato.
    //
    // La fecha del documento es la fecha OPERATIVA (fechaOperativa), no la de
    // calendario — un pedido antes de horaCierreOperativo cuenta como venta
    // del día anterior. Con horaCierreOperativo por defecto ("00:00") esto es
    // exactamente el día de calendario en hora de RD, igual que antes.
    const conteoPlatos = {};
    itemsValidados.forEach((item) => {
      if (!conteoPlatos[item.platoId]) conteoPlatos[item.platoId] = { nombre: item.nombre, cantidad: 0 };
      conteoPlatos[item.platoId].cantidad += 1;
    });
    const platosField = {};
    Object.entries(conteoPlatos).forEach(([platoId, { nombre, cantidad }]) => {
      platosField[platoId] = { nombre, cantidad: FieldValue.increment(cantidad) };
    });
    tx.set(db.doc(`restaurantes/${restauranteId}/ventasDiarias/${fechaOperativa(Date.now(), horaCierreOperativo)}`), {
      total: FieldValue.increment(total),
      subtotal: FieldValue.increment(subtotal),
      itbis: FieldValue.increment(itbis),
      propina: FieldValue.increment(propina),
      cantidadPedidos: FieldValue.increment(1),
      platos: platosField,
    }, { merge: true });

    return { pedidoId: nuevoPedidoRef.id, total };
  });

  return resultado;
});

const CODIGO_EXPIRACION_MS = 10 * 60 * 1000;
const CODIGO_MAX_INTENTOS = 5;
const REENVIO_MAX_POR_HORA = 3;
const REENVIO_WINDOW_MS = 60 * 60 * 1000;

/**
 * enviarCodigoInvitacion — callable Cloud Function.
 *
 * Recibe { token, email }. Verifica que el correo no tenga cuenta ya, genera
 * un código de 6 dígitos (crypto.randomInt — nunca Math.random), lo guarda
 * HASHEADO (SHA-256 + sal, nunca en texto plano) en
 * invitaciones/{token}/_privado/codigo, y lo envía por correo con Resend.
 *
 * Verificar el correo con un código ANTES de crear la cuenta (en vez de un
 * enlace de verificación después) evita el problema real que motivó esto:
 * un typo en el correo creaba una cuenta permanentemente irrecuperable — el
 * código nunca llega, nunca se crea nada.
 */
exports.enviarCodigoInvitacion = onCall(
  { region: 'us-central1', timeoutSeconds: 30, enforceAppCheck: true, secrets: [resendApiKey] },
  async (request) => {
    const { token, email } = request.data;

    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'Invitación inválida.');
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Correo inválido.');
    }

    const invitacionRef = db.doc(`invitaciones/${token}`);
    const invitacionSnap = await invitacionRef.get();
    if (!invitacionSnap.exists) {
      throw new HttpsError('not-found', 'Esta invitación no existe.');
    }
    const inv = invitacionSnap.data();
    validarInvitacionActiva(inv);

    const restauranteSnap = await db.doc(`restaurantes/${inv.restauranteId}`).get();
    if (!restauranteSnap.exists) {
      throw new HttpsError('failed-precondition', 'El restaurante de esta invitación ya no existe.');
    }

    // Correo ya registrado: no se manda código, no se toca la invitación.
    try {
      await getAuth().getUserByEmail(email);
      throw new HttpsError('already-exists', 'Ya existe una cuenta con este correo. Inicia sesión y pídele al maestro que te asigne el acceso.');
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      if (e.code !== 'auth/user-not-found') {
        throw new HttpsError('internal', `No se pudo verificar el correo: ${e.message || 'error desconocido'}`);
      }
      // auth/user-not-found es lo esperado: el correo está libre, se continúa.
    }

    // ── Rate limit: máx 3 códigos por invitación por hora — mismo patrón de
    // runTransaction (count + windowStart) que el rate limiting de crearPedido.
    const rateLimitRef = invitacionRef.collection('_privado').doc('rateLimit');
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateLimitRef);
      const now = Date.now();
      if (snap.exists) {
        const { count, windowStart } = snap.data();
        if (now - windowStart < REENVIO_WINDOW_MS) {
          if (count >= REENVIO_MAX_POR_HORA) {
            throw new HttpsError('resource-exhausted', 'Demasiados códigos enviados. Espera un poco antes de pedir otro.');
          }
          tx.update(rateLimitRef, { count: FieldValue.increment(1) });
        } else {
          tx.set(rateLimitRef, { count: 1, windowStart: now });
        }
      } else {
        tx.set(rateLimitRef, { count: 1, windowStart: now });
      }
    });

    // ── Generar y guardar el código — hasheado, nunca en texto plano ─────────
    const codigo = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');
    await invitacionRef.collection('_privado').doc('codigo').set({
      hash: hashCodigo(codigo, salt),
      salt,
      email,
      expiraEn: new Date(Date.now() + CODIGO_EXPIRACION_MS),
      intentos: 0,
    });

    // ── Enviar el correo con Resend ───────────────────────────────────────────
    const rolLabel = inv.rol === 'admin' ? 'administrador' : 'cocina';
    try {
      const resend = new Resend(resendApiKey.value());
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: `Tu código de acceso a MesaDigital: ${codigo}`,
        html: plantillaCorreoCodigo({ codigo, nombreRestaurante: restauranteSnap.data().nombre || 'tu restaurante', rolLabel }),
      });
    } catch (e) {
      throw new HttpsError('internal', `No se pudo enviar el correo: ${e.message || 'error desconocido'}`);
    }

    return { ok: true };
  }
);

/**
 * canjearInvitacion — callable Cloud Function.
 *
 * Recibe { token, codigo, password }. Revalida la invitación y el código
 * (contra el hash guardado por enviarCodigoInvitacion, con
 * crypto.timingSafeEqual), crea la cuenta con Admin SDK marcando
 * emailVerified: true (ya se probó con el código), y en una transacción
 * otorga el rol y marca la invitación como usada — todo atómico, para que
 * nunca quede una cuenta huérfana sin rol. Devuelve un custom token para que
 * el cliente inicie sesión con esa cuenta.
 *
 * createCustomToken() requiere el permiso IAM
 * 'iam.serviceAccounts.signBlob' otorgado a la cuenta de servicio de Cloud
 * Functions sobre sí misma (rol "Service Account Token Creator") — ya está
 * otorgado en este proyecto.
 */
exports.canjearInvitacion = onCall({ region: 'us-central1', timeoutSeconds: 30, enforceAppCheck: true }, async (request) => {
  const { token, codigo, password } = request.data;

  if (!token || typeof token !== 'string') {
    throw new HttpsError('invalid-argument', 'Invitación inválida.');
  }
  if (!codigo || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
    throw new HttpsError('invalid-argument', 'Código inválido.');
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
  }

  const invitacionRef = db.doc(`invitaciones/${token}`);
  const invitacionSnap = await invitacionRef.get();
  if (!invitacionSnap.exists) {
    throw new HttpsError('not-found', 'Esta invitación no existe.');
  }
  const inv = invitacionSnap.data();
  validarInvitacionActiva(inv);

  const restauranteRef = db.doc(`restaurantes/${inv.restauranteId}`);
  const restauranteSnap = await restauranteRef.get();
  if (!restauranteSnap.exists) {
    throw new HttpsError('failed-precondition', 'El restaurante de esta invitación ya no existe.');
  }

  // ── Validar el código ──────────────────────────────────────────────────────
  // Todo en una transacción: leer intentos, decidir y (si el código no
  // coincide) incrementar intentos, deben ser atómicos. Un read-then-write
  // suelto aquí es explotable — varias peticiones concurrentes con códigos
  // distintos leerían el mismo `intentos` antes de que ninguna escriba, y
  // cada una escribiría `intentos+1` sobre ese mismo valor viejo (el
  // contador nunca sube más allá de 1 sin importar cuántas peticiones en
  // paralelo se manden), evadiendo por completo el límite de
  // CODIGO_MAX_INTENTOS y habilitando fuerza bruta real contra el código de
  // 6 dígitos vía paralelismo. La transacción serializa los intentos
  // concurrentes contra el mismo documento, igual que el rate limit de
  // crearPedido/enviarCodigoInvitacion.
  const codigoRef = invitacionRef.collection('_privado').doc('codigo');
  const resultadoCodigo = await db.runTransaction(async (tx) => {
    const codigoSnap = await tx.get(codigoRef);
    if (!codigoSnap.exists) return { estado: 'no-existe' };
    const codigoData = codigoSnap.data();
    if (codigoData.intentos >= CODIGO_MAX_INTENTOS) return { estado: 'agotado' };
    if (!codigoData.expiraEn || codigoData.expiraEn.toMillis() < Date.now()) return { estado: 'vencido' };

    const hashRecibido = hashCodigo(codigo, codigoData.salt);
    const coincide = hashRecibido.length === codigoData.hash.length
      && crypto.timingSafeEqual(Buffer.from(hashRecibido), Buffer.from(codigoData.hash));

    if (!coincide) {
      const nuevosIntentos = codigoData.intentos + 1;
      tx.update(codigoRef, { intentos: nuevosIntentos });
      return { estado: 'incorrecto', restantes: CODIGO_MAX_INTENTOS - nuevosIntentos };
    }
    return { estado: 'ok', email: codigoData.email };
  });

  if (resultadoCodigo.estado === 'no-existe') {
    throw new HttpsError('failed-precondition', 'No se ha enviado un código para esta invitación. Pide uno nuevo.');
  }
  if (resultadoCodigo.estado === 'agotado') {
    throw new HttpsError('failed-precondition', 'Demasiados intentos fallidos. Pide un código nuevo.');
  }
  if (resultadoCodigo.estado === 'vencido') {
    throw new HttpsError('failed-precondition', 'El código venció. Pide uno nuevo.');
  }
  if (resultadoCodigo.estado === 'incorrecto') {
    if (resultadoCodigo.restantes <= 0) {
      throw new HttpsError('failed-precondition', 'Código incorrecto. Se agotaron los intentos — pide un código nuevo.');
    }
    throw new HttpsError('failed-precondition', `Código incorrecto. Te quedan ${resultadoCodigo.restantes} intento(s).`);
  }

  const email = resultadoCodigo.email;

  // ── Crear la cuenta ANTES de tocar la invitación: si falla aquí (contraseña
  // rechazada, correo registrado justo ahora por otra vía), la invitación
  // sigue intacta — no queda nada a medias. emailVerified: true porque el
  // código ya lo probó.
  let uid;
  try {
    const userRecord = await getAuth().createUser({ email, password, emailVerified: true });
    uid = userRecord.uid;
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Ya existe una cuenta con este correo. Inicia sesión y pídele al maestro que te asigne el acceso.');
    }
    throw new HttpsError('invalid-argument', `No se pudo crear la cuenta: ${e.message || e.code || 'error desconocido'}`);
  }

  const campoRol = inv.rol === 'admin' ? 'adminUids' : 'cocinaUids';

  try {
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(invitacionRef);
      const fresh = freshSnap.data();
      if (!freshSnap.exists || fresh.revocada || fresh.usadaPor || !fresh.expiraEn || fresh.expiraEn.toMillis() < Date.now()) {
        throw new HttpsError('failed-precondition', 'Esta invitación ya no es válida.');
      }
      tx.update(restauranteRef, { [campoRol]: FieldValue.arrayUnion(uid) });
      tx.update(invitacionRef, { usadaPor: uid, usadaEn: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    // Compensación: nunca dejar una cuenta de Auth sin rol y sin explicación.
    await getAuth().deleteUser(uid).catch(() => {});
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', `No se pudo completar el registro: ${e.message || 'error desconocido'}`);
  }

  // El código ya cumplió su función — que no quede reutilizable.
  await codigoRef.delete().catch(() => {});

  // La cuenta y el rol YA quedaron asignados en este punto — un fallo aquí no
  // debe borrar nada, solo avisar que falta iniciar sesión manualmente.
  let customToken;
  try {
    customToken = await getAuth().createCustomToken(uid);
  } catch (e) {
    throw new HttpsError('internal', `Tu cuenta y acceso se crearon correctamente, pero no se pudo iniciar sesión automáticamente (${e.message || 'error desconocido'}). Inicia sesión manualmente con tu correo y contraseña.`);
  }

  return { customToken, restauranteId: inv.restauranteId, rol: inv.rol };
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

      try {
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
      } catch (e) {
        // Un fallo en un restaurante (p.ej. cuota excedida) no debe impedir
        // limpiar los demás; el siguiente corrido (24h) retoma lo pendiente.
        console.error(`[${restauranteId}] error limpiando pedidos archivados:`, e.message);
        continue;
      }

      if (borradosEnEstRest > 0) {
        console.log(`[${restauranteId}] pedidos archivados eliminados: ${borradosEnEstRest}`);
        totalBorrados += borradosEnEstRest;
      }

      // ── _ratelimits huérfanos ────────────────────────────────────────────
      // Un documento por cliente/mesa que alguna vez pidió (ver crearPedido).
      // Nada los borra nunca — ni siquiera limpiarUsuariosAnonimos, que borra
      // la cuenta de Auth pero no toca esta colección de Firestore, que vive
      // aparte. Cada ventana dura 60s; cualquier documento con windowStart de
      // más de un día es indudablemente muerto (ese UID/mesa, si vuelve a
      // pedir, sobrescribe el documento igual — no hace falta conservarlo).
      // Try/catch propio: un fallo aquí no debe impedir la limpieza de
      // pedidos archivados de arriba, ni la de los demás restaurantes.
      try {
        const cutoffRateLimit = Date.now() - 24 * 60 * 60 * 1000;
        const ratelimitsSnap = await db
          .collection(`restaurantes/${restauranteId}/_ratelimits`)
          .where('windowStart', '<', cutoffRateLimit)
          .limit(BATCH_SIZE)
          .get();
        if (!ratelimitsSnap.empty) {
          const batchRL = db.batch();
          ratelimitsSnap.docs.forEach((d) => batchRL.delete(d.ref));
          await batchRL.commit();
          console.log(`[${restauranteId}] _ratelimits huérfanos eliminados: ${ratelimitsSnap.size}`);
        }
      } catch (e) {
        console.error(`[${restauranteId}] error limpiando _ratelimits:`, e.message);
      }
    }

    console.log(`Limpieza completada. Total pedidos eliminados: ${totalBorrados}`);
  }
);

// ── Limpieza semanal de invitaciones antiguas (usadas o vencidas hace más de
// 30 días) ───────────────────────────────────────────────────────────────
// Una invitación usada o vencida no se puede volver a canjear
// (canjearInvitacion la rechaza), así que dejarla en Firestore para siempre
// es solo acumulación. Se borra junto con su subcolección _privado (el hash
// del código y el rate limit) — Firestore no borra subcolecciones en
// cascada, así que borrar solo el documento padre los dejaría huérfanos.
//
// Dos condiciones, no una: expiraEn es siempre creadoEn + 7 días, fijo desde
// la creación, sin importar cuándo (o si) se usó la invitación. Una
// invitación usada al día siguiente de creada puede tener usadaEn con más de
// 30 días de antigüedad mientras expiraEn (solo 7 días después de crearse)
// todavía no cumple el umbral por sí solo — por eso se consultan usadaEn y
// expiraEn por separado y se combinan.
exports.limpiarInvitacionesAntiguas = onSchedule(
  { schedule: 'every 168 hours', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    const { Timestamp } = require('firebase-admin/firestore');
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    // Margen bajo el límite de 500 escrituras por batch de Firestore — cada
    // invitación puede sumar hasta 3 escrituras (el documento + _privado/codigo
    // + _privado/rateLimit).
    const MAX_WRITES_POR_LOTE = 450;

    const [usadasSnap, vencidasSnap] = await Promise.all([
      db.collection('invitaciones').where('usadaEn', '<', cutoff).get(),
      db.collection('invitaciones').where('expiraEn', '<', cutoff).get(),
    ]);

    const porBorrar = new Map();
    usadasSnap.docs.forEach((d) => porBorrar.set(d.id, d.ref));
    vencidasSnap.docs.forEach((d) => porBorrar.set(d.id, d.ref));

    let batch = db.batch();
    let writesEnLote = 0;
    let totalBorrados = 0;
    let totalErrores = 0;

    for (const ref of porBorrar.values()) {
      try {
        const privadoSnap = await ref.collection('_privado').get();
        if (writesEnLote + privadoSnap.size + 1 > MAX_WRITES_POR_LOTE) {
          await batch.commit();
          batch = db.batch();
          writesEnLote = 0;
        }
        privadoSnap.docs.forEach((p) => { batch.delete(p.ref); writesEnLote++; });
        batch.delete(ref);
        writesEnLote++;
        totalBorrados++;
      } catch (e) {
        // Un fallo con una invitación puntual no debe impedir procesar las
        // demás; la siguiente corrida (semanal) retoma lo pendiente.
        console.error(`Error preparando borrado de invitación ${ref.id}:`, e.message);
        totalErrores++;
      }
    }

    if (writesEnLote > 0) await batch.commit();

    console.log(`Invitaciones antiguas eliminadas: ${totalBorrados}${totalErrores ? ` (errores: ${totalErrores})` : ''}`);
  }
);
