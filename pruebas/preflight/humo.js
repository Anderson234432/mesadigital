// Prueba de humo real: crea un pedido de VERDAD contra la Cloud Function
// crearPedido (la misma que usa un cliente real), lo verifica en Firestore,
// confirma que la consulta que usa Cocina.jsx lo vería, y lo borra —
// revirtiendo también los contadores que haya tocado (stats.mesasPendientes,
// ventasDiarias, _ratelimits) para dejar el restaurante exactamente como
// estaba antes de correr esto.
//
// ⚠️ POR QUÉ ES OPCIONAL (--con-pedido-de-prueba): esto escribe un pedido
// real en la mesa que se le indique (por defecto, la mesa 1). Si el
// restaurante ya está operando y alguien tiene la pantalla de Cocina
// abierta, va a VER aparecer y desaparecer ese pedido durante uno o dos
// segundos. Para una entrega nueva (el caso normal de este script) no hay
// nadie mirando esa pantalla todavía, así que es seguro — pero si vas a
// correr el preflight contra un restaurante que YA está en servicio, hazlo
// fuera de horas pico o avisa a cocina antes.

import { initializeApp as initClientApp, deleteApp } from 'firebase/app';
import { getAuth as getClientAuth, signInAnonymously } from 'firebase/auth';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { PROJECT_ID, FIREBASE_CLIENT_CONFIG, APPCHECK_DEBUG_TOKEN } from '../config.js';
import { db, auth as adminAuth } from './gcp.js';

// Mismo cálculo que functions/lib/fechaOperativa.js y src/utils/fechaOperativa.js
// (duplicado a propósito, ver el comentario de esos archivos sobre por qué
// no se comparte un solo módulo entre los tres paquetes de Node).
const OFFSET_RD_MS = 4 * 60 * 60 * 1000;
function parsearHoraCierre(horaCierreOperativo) {
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(horaCierreOperativo || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function inicioDiaOperativoHoy(horaCierreOperativo) {
  const minutosCierre = parsearHoraCierre(horaCierreOperativo);
  const ahoraLocal = new Date(Date.now() - OFFSET_RD_MS);
  const minutosLocal = ahoraLocal.getUTCHours() * 60 + ahoraLocal.getUTCMinutes();
  const diaBase = minutosLocal < minutosCierre
    ? new Date(ahoraLocal.getTime() - 24 * 60 * 60 * 1000)
    : ahoraLocal;
  const medianocheUtc = Date.UTC(diaBase.getUTCFullYear(), diaBase.getUTCMonth(), diaBase.getUTCDate());
  return new Date(medianocheUtc + OFFSET_RD_MS + minutosCierre * 60 * 1000);
}

async function exchangeDebugToken(debugToken) {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${FIREBASE_CLIENT_CONFIG.appId}:exchangeDebugToken?key=${FIREBASE_CLIENT_CONFIG.apiKey}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ debug_token: debugToken }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`No se pudo canjear el token de depuración de App Check: ${body?.error?.message || res.status}`);
  return body.token;
}

export async function pruebaDeHumo(reporte, restauranteId, { mesa }) {
  reporte.categoria('Prueba de humo real (pedido de prueba)');

  if (!APPCHECK_DEBUG_TOKEN || APPCHECK_DEBUG_TOKEN === '__FALTA_REGISTRAR__') {
    reporte.aviso(
      'Prueba de humo',
      'No se corrió: falta el token de depuración de App Check.',
      'Corre `node appcheck-debug-token.js` desde pruebas/ una vez, y vuelve a correr el preflight con --con-pedido-de-prueba.'
    );
    return;
  }

  const restRef = db.collection('restaurantes').doc(restauranteId);
  const restSnap = await restRef.get();
  if (!restSnap.exists) {
    reporte.aviso('Prueba de humo', 'No se corrió: el restaurante no existe (ya se reportó arriba).');
    return;
  }
  const r = restSnap.data();

  const platosSnap = await restRef.collection('platos').where('disponible', '!=', false).limit(1).get();
  if (platosSnap.empty) {
    reporte.aviso('Prueba de humo', 'No se corrió: no hay ningún plato disponible para armar un pedido de prueba (ya se reportó arriba).');
    return;
  }
  const plato = { id: platosSnap.docs[0].id, ...platosSnap.docs[0].data() };

  const privadoSnap = await restRef.collection('_privado').doc('mesaTokens').get();
  const mesaTokens = privadoSnap.exists ? (privadoSnap.data().mesaTokens || {}) : {};
  const mesaStr = String(mesa);
  const token = mesaTokens[mesaStr] || '';
  if (Object.keys(mesaTokens).length > 0 && !token) {
    reporte.fallo(
      'Prueba de humo',
      `No se pudo probar: la mesa "${mesaStr}" no tiene token configurado.`,
      `Usa --mesa=N con un número de mesa que sí tenga token (mesas configuradas: ${Object.keys(mesaTokens).join(', ') || 'ninguna'}).`
    );
    return;
  }

  let clientApp;
  let uid;
  let pedidoId;
  try {
    await reporte.ejecutar('Crear el pedido de prueba', async () => {
      clientApp = initClientApp(FIREBASE_CLIENT_CONFIG, `preflight-humo-${Date.now()}`);
      initializeAppCheck(clientApp, {
        provider: new CustomProvider({
          getToken: async () => ({ token: await exchangeDebugToken(APPCHECK_DEBUG_TOKEN), expireTimeMillis: Date.now() + 30 * 60 * 1000 }),
        }),
        isTokenAutoRefreshEnabled: false,
      });
      const clientAuth = getClientAuth(clientApp);
      const cred = await signInAnonymously(clientAuth);
      uid = cred.user.uid;
      const crearPedidoFn = httpsCallable(getFunctions(clientApp, 'us-central1'), 'crearPedido');
      const idempotencyKey = `preflight-humo-${Date.now()}`;
      const res = await crearPedidoFn({
        restauranteId,
        mesa: mesaStr,
        items: [{ id: plato.id, cantidad: 1 }],
        nota: '🧪 PEDIDO DE PRUEBA (verificación previa a la entrega) — si ves esto en Cocina, bórralo, es del preflight.',
        clienteUid: uid,
        idempotencyKey,
        token,
      });
      pedidoId = res.data.pedidoId;
      reporte.ok('Pedido de prueba creado', `pedidoId=${pedidoId}, plato="${plato.nombre}", mesa ${mesaStr}, total RD$${res.data.total}.`);
    });

    if (!pedidoId) return; // el paso anterior ya reportó el fallo

    await reporte.ejecutar('El pedido quedó guardado en Firestore', async () => {
      const pedidoSnap = await restRef.collection('pedidos').doc(pedidoId).get();
      if (!pedidoSnap.exists) {
        reporte.fallo('El pedido quedó en Firestore', 'La función devolvió éxito pero el documento no existe.', 'Esto sería un bug real de crearPedido — repórtalo, no lo arregles aquí.');
        return;
      }
      const p = pedidoSnap.data();
      if (p.estado === 'pendiente' && p.mesa === mesaStr) {
        reporte.ok('El pedido quedó en Firestore', `estado="pendiente", mesa="${p.mesa}", ${p.items.length} ítem(s).`);
      } else {
        reporte.fallo('El pedido quedó en Firestore', `Datos inesperados: estado="${p.estado}", mesa="${p.mesa}".`, 'Repórtalo — no debería pasar con un pedido recién creado.');
      }
    });

    await reporte.ejecutar('Aparece en la consulta que usa Cocina', async () => {
      // Misma consulta que subscribePedidosHoy (src/services/pedidosService.js):
      // pedidos con creadoEn >= inicio del día operativo, filtrando
      // 'archivado' en memoria — igual que hace Cocina.jsx.
      const inicio = inicioDiaOperativoHoy(r.horaCierreOperativo || '00:00');
      const hoySnap = await restRef.collection('pedidos').where('creadoEn', '>=', inicio).get();
      const visibleEnCocina = hoySnap.docs.some((d) => d.id === pedidoId && d.data().estado !== 'archivado');
      if (visibleEnCocina) {
        reporte.ok('Visible en Cocina', 'El pedido aparece en la misma consulta que usa la pantalla de Cocina.');
      } else {
        reporte.fallo('Visible en Cocina', 'El pedido existe pero NO aparece en la consulta que usa Cocina.jsx.', 'Puede ser un problema de horaCierreOperativo mal configurado, o un bug real — repórtalo.');
      }
    });
  } finally {
    // ── Limpieza: pase lo que pase arriba, dejar todo como estaba ────────
    await reporte.ejecutar('Limpieza del pedido de prueba', async () => {
      const tareas = [];
      let huboCambiosDeContador = false;

      if (pedidoId) {
        const pedidoRef = restRef.collection('pedidos').doc(pedidoId);
        const pedidoSnap = await pedidoRef.get();
        if (pedidoSnap.exists) {
          const p = pedidoSnap.data();
          tareas.push(pedidoRef.delete());

          // Revertir ventasDiarias — mismo documento que incrementó crearPedido.
          const fechaOp = inicioDiaOperativoHoy(r.horaCierreOperativo || '00:00');
          const fechaStr = fechaOp.toISOString().slice(0, 10);
          const ventasRef = restRef.collection('ventasDiarias').doc(fechaStr);
          const decremento = {
            total: FieldValue.increment(-(p.total || 0)),
            subtotal: FieldValue.increment(-(p.subtotal || 0)),
            itbis: FieldValue.increment(-(p.itbis || 0)),
            propina: FieldValue.increment(-(p.propina || 0)),
            cantidadPedidos: FieldValue.increment(-1),
            [`platos.${plato.id}.cantidad`]: FieldValue.increment(-1),
          };
          tareas.push(ventasRef.set(decremento, { merge: true }));
          huboCambiosDeContador = true;
        }
      }

      // Revertir stats.mesasPendientes SOLO si esta fue la única ronda
      // pendiente de la mesa que abrimos (isNewMesa) — si ya había otro
      // pedido pendiente real de esa mesa antes de esta prueba, crearPedido
      // no incrementó el contador, y no hay que tocarlo.
      if (huboCambiosDeContador) {
        const otrosPendientes = await restRef.collection('pedidos')
          .where('mesa', '==', mesaStr).where('estado', '==', 'pendiente').limit(1).get();
        if (otrosPendientes.empty) {
          tareas.push(restRef.update({ 'stats.mesasPendientes': FieldValue.increment(-1) }).catch(() => {}));
        }
      }

      // Rate limits que esta prueba haya tocado — no son sensibles, pero
      // dejarlos en 0 evita que la próxima corrida del preflight, o el
      // primer pedido real del restaurante, arranque ya con un contador
      // parcialmente gastado.
      if (uid) tareas.push(restRef.collection('_ratelimits').doc(uid).delete().catch(() => {}));
      tareas.push(restRef.collection('_ratelimits').doc(`mesa_${mesaStr}`).delete().catch(() => {}));

      await Promise.all(tareas);
      if (uid) await adminAuth.deleteUser(uid).catch(() => {});
      if (clientApp) await deleteApp(clientApp).catch(() => {});

      reporte.ok('Limpieza del pedido de prueba', 'Pedido borrado y contadores (ventas del día, mesas pendientes, límites de frecuencia) revertidos.');
    });
  }
}
