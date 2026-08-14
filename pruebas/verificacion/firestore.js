// Lee y compara contra Firestore con el Admin SDK — la fuente de verdad
// para "¿lo que pidió la mesa es exactamente lo que quedó guardado?".
// Cada función de comparación devuelve una lista de discrepancias
// ({ campo, esperado, encontrado }), vacía si todo coincide — nunca un
// booleano solo, para que el reporte pueda mostrar el detalle exacto.

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ADC_CREDENTIALS_PATH, PROJECT_ID, RESTAURANTE_ID } from '../config.js';

if (getApps().length === 0) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_CREDENTIALS_PATH;
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}
export const db = getFirestore();
export const auth = getAuth();

export async function leerPedido(pedidoId, restauranteId = RESTAURANTE_ID) {
  const snap = await db.collection('restaurantes').doc(restauranteId).collection('pedidos').doc(pedidoId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function leerUltimoPedidoDeMesa(mesa, restauranteId = RESTAURANTE_ID) {
  const snap = await db.collection('restaurantes').doc(restauranteId).collection('pedidos')
    .where('mesa', '==', String(mesa))
    .orderBy('creadoEn', 'desc').limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function leerPedidosDeMesa(mesa, restauranteId = RESTAURANTE_ID) {
  const snap = await db.collection('restaurantes').doc(restauranteId).collection('pedidos')
    .where('mesa', '==', String(mesa)).orderBy('creadoEn', 'asc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function leerRestaurante(restauranteId = RESTAURANTE_ID) {
  const snap = await db.collection('restaurantes').doc(restauranteId).get();
  return snap.data();
}

export async function leerVentasDiarias(fecha, restauranteId = RESTAURANTE_ID) {
  const snap = await db.collection('restaurantes').doc(restauranteId).collection('ventasDiarias').doc(fecha).get();
  return snap.exists ? snap.data() : null;
}

// Fecha operativa de "ahora" en hora de RD (UTC-4 fijo) — mismo cálculo que
// functions/lib/fechaOperativa.js, reescrito acá porque pruebas/ no
// importa código de functions/ (paquetes de Node separados, ver
// INVENTARIO_MESADIGITAL.md). Sirve para saber en qué documento de
// ventasDiarias buscar.
export function fechaOperativaHoy(horaCierreOperativo = '00:00') {
  const OFFSET_MS = 4 * 60 * 60 * 1000;
  const [h, m] = horaCierreOperativo.split(':').map(Number);
  const corteMin = h * 60 + m;
  const ahoraMs = Date.now();
  const minutosRD = Math.floor((ahoraMs - OFFSET_MS) / 60000);
  const diaIdx = Math.floor(minutosRD / 1440) - (minutosRD % 1440 < corteMin && corteMin > 0 ? 1 : 0);
  const fecha = new Date(diaIdx * 86400000);
  return fecha.toISOString().slice(0, 10);
}

// items[] no tiene id propio en Firestore — se compara por multiset de
// {nombre, precio}, no por índice: un pedido con [A, A, B] debe coincidir
// con cualquier orden de esos mismos 3 items, pero NO con [A, B] (cantidad
// perdida) ni con [A, A, C] (item cambiado).
function multisetItems(items) {
  const claves = items.map((i) => `${i.nombre}::${i.precio}`);
  const conteo = {};
  claves.forEach((c) => { conteo[c] = (conteo[c] || 0) + 1; });
  return conteo;
}

export function compararItems(esperados, encontrados) {
  const discrepancias = [];
  const a = multisetItems(esperados);
  const b = multisetItems(encontrados);
  const todasLasClaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const clave of todasLasClaves) {
    if ((a[clave] || 0) !== (b[clave] || 0)) {
      discrepancias.push({
        campo: `items[${clave}]`,
        esperado: a[clave] || 0,
        encontrado: b[clave] || 0,
      });
    }
  }
  return discrepancias;
}

// Compara un pedido esperado (lo que el escenario armó/pidió) contra lo
// que realmente quedó en Firestore. `esperado` es parcial a propósito —
// solo se compara lo que el escenario provee.
export function compararPedido(esperado, encontrado) {
  const discrepancias = [];
  if (!encontrado) {
    return [{ campo: 'pedido', esperado: '(existe)', encontrado: '(no se creó ningún pedido)' }];
  }
  if (esperado.mesa != null && String(encontrado.mesa) !== String(esperado.mesa)) {
    discrepancias.push({ campo: 'mesa', esperado: esperado.mesa, encontrado: encontrado.mesa });
  }
  if (esperado.estado != null && encontrado.estado !== esperado.estado) {
    discrepancias.push({ campo: 'estado', esperado: esperado.estado, encontrado: encontrado.estado });
  }
  if (esperado.total != null && encontrado.total !== esperado.total) {
    discrepancias.push({ campo: 'total', esperado: esperado.total, encontrado: encontrado.total });
  }
  if (esperado.nota != null && (encontrado.nota || '') !== esperado.nota) {
    discrepancias.push({ campo: 'nota', esperado: esperado.nota, encontrado: encontrado.nota });
  }
  if (esperado.clienteUid != null && encontrado.clienteUid !== esperado.clienteUid) {
    discrepancias.push({ campo: 'clienteUid', esperado: esperado.clienteUid, encontrado: encontrado.clienteUid });
  }
  if (esperado.items != null) {
    discrepancias.push(...compararItems(esperado.items, encontrado.items || []));
  }
  return discrepancias;
}

export async function contarPedidosConIdempotencyKey(idempotencyKey, restauranteId = RESTAURANTE_ID) {
  const snap = await db.collection('restaurantes').doc(restauranteId).collection('pedidos')
    .where('idempotencyKey', '==', idempotencyKey).get();
  return snap.size;
}

export async function borrarCuentaAnonima(uid) {
  await auth.deleteUser(uid).catch(() => {});
}

// Limpia los contadores de rate limit de una mesa/uid — para que un
// escenario que no está probando el rate limit no falle por acumulación de
// llamadas de escenarios anteriores en la misma mesa. Nunca toca las
// reglas ni la lógica de rate limit en sí, solo el contador de ESTE
// restaurante de pruebas (misma colección que ya usa la Cloud Function).
export async function limpiarRateLimits({ mesa, uid } = {}, restauranteId = RESTAURANTE_ID) {
  const refs = [];
  if (mesa != null) refs.push(db.doc(`restaurantes/${restauranteId}/_ratelimits/mesa_${mesa}`));
  if (uid) refs.push(db.doc(`restaurantes/${restauranteId}/_ratelimits/${uid}`));
  await Promise.all(refs.map((r) => r.delete().catch(() => {})));
}

export async function establecerHorarios(horarios, restauranteId = RESTAURANTE_ID) {
  await db.collection('restaurantes').doc(restauranteId).update({ horarios });
}

export async function establecerDisponible(platoId, disponible, restauranteId = RESTAURANTE_ID) {
  await db.collection('restaurantes').doc(restauranteId).collection('platos').doc(platoId).update({ disponible });
}

export async function establecerPrecio(platoId, precio, restauranteId = RESTAURANTE_ID) {
  await db.collection('restaurantes').doc(restauranteId).collection('platos').doc(platoId).update({ precio });
}
