// Backfill de restaurantes/{id}/ventasDiarias a partir de pedidos ya existentes.
//
// Por qué existe: ventasDiarias solo se escribe hacia adelante, desde el
// momento en que se despliega la Cloud Function crearPedido con esta
// agregación (ver functions/index.js). Los pedidos anteriores a ese deploy
// no tienen su venta reflejada ahí — este script la reconstruye leyendo
// pedidos/ directamente, una sola vez.
//
// CRÍTICO — evita contar pedidos dos veces:
// Pasa como argumento la fecha/hora EXACTA en que se desplegó la Cloud
// Function (la que imprime `firebase deploy --only functions` al terminar,
// o cualquier timestamp de ese momento). Solo se procesan pedidos con
// creadoEn ANTERIOR a ese instante — los posteriores ya fueron sumados en
// tiempo real por la propia Cloud Function, y sumarlos de nuevo aquí
// duplicaría las ventas.
//
// Uso:
//   cd functions
//   node scripts/backfillVentasDiarias.js "2026-08-07T18:30:00Z"
//
// Requiere credenciales de administrador (usa Application Default
// Credentials). Si tienes `gcloud` instalado: `gcloud auth application-default
// login`. Si no, `firebase-tools` ya guarda credenciales utilizables por
// cuenta logueada en:
//   %APPDATA%\firebase\{tu_correo}_application_default_credentials.json  (Windows)
//   ~/.config/firebase/{tu_correo}_application_default_credentials.json  (Linux/Mac)
// (se genera la primera vez que corres `firebase emulators:start` o
// `firebase functions:shell`). Apunta GOOGLE_APPLICATION_CREDENTIALS a ese
// archivo, o exporta esa variable apuntando a una service account key.
//
// Advertencia sobre el histórico: limpiarPedidosAntiguos (functions/index.js)
// borra pedidos archivados con más de 90 días. Este script solo puede
// reconstruir ventasDiarias para pedidos que TODAVÍA existan en Firestore —
// las ventas más viejas que eso ya no son recuperables.
//
// IDEMPOTENCIA: usa FieldValue.increment(), así que correrlo dos veces
// duplicaría cada cifra. Por eso cada restaurante tiene un documento marcador
// en restaurantes/{id}/_meta/backfillVentasDiarias: se reserva ANTES de
// escribir nada (completado:false) y se cierra DESPUÉS de escribir todos los
// días (completado:true). Si el marcador ya existe — sea completado o no —
// el restaurante se omite por completo y no se toca ventasDiarias. Un
// marcador con completado:false significa que una corrida anterior murió a
// medias; revisa manualmente (compara ventasDiarias contra pedidos) antes de
// borrar ese documento para reintentar.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const path = require('node:path');
const fs = require('node:fs');

// Con credenciales de usuario (Application Default Credentials vía
// firebase-tools) el projectId no viene embebido, a diferencia de una service
// account key — hay que indicarlo explícitamente o falla con "Unable to
// detect a Project Id". Se toma de .firebaserc para no hardcodearlo aquí.
const projectId = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '.firebaserc'), 'utf8')
).projects.default;

const cutoffArg = process.argv[2];
if (!cutoffArg) {
  console.error('Falta el argumento de corte. Uso: node backfillVentasDiarias.js "2026-08-07T18:30:00Z"');
  process.exit(1);
}
const cutoffDate = new Date(cutoffArg);
if (Number.isNaN(cutoffDate.getTime())) {
  console.error(`Fecha de corte inválida: "${cutoffArg}". Usa formato ISO, ej. 2026-08-07T18:30:00Z`);
  process.exit(1);
}
const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

// Misma fórmula que fechaLocalRD() en functions/index.js — RD es UTC-4 fijo,
// sin horario de verano.
function fechaLocalRD(fecha) {
  return new Date(fecha.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function backfillRestaurante(restauranteId) {
  // ── Reservar el marcador ANTES de leer/escribir nada — si ya existe (de
  // esta corrida o de una anterior), este restaurante se omite entero. Esto
  // es lo que hace el script idempotente: una segunda corrida no vuelve a
  // sumar nada.
  const marcadorRef = db.doc(`restaurantes/${restauranteId}/_meta/backfillVentasDiarias`);
  const marcadorSnap = await marcadorRef.get();
  if (marcadorSnap.exists) {
    const m = marcadorSnap.data();
    console.log(`[${restauranteId}] omitido — ya existe un marcador de backfill (completado: ${m.completado}, cutoff: ${m.cutoff?.toDate?.().toISOString()}).`);
    if (!m.completado) {
      console.log(`[${restauranteId}] ese marcador quedó incompleto — revisa manualmente (ventasDiarias vs pedidos) antes de borrar el documento _meta/backfillVentasDiarias para reintentar.`);
    }
    return;
  }
  await marcadorRef.set({ completado: false, cutoff: cutoffTimestamp, iniciadoEn: FieldValue.serverTimestamp() });

  const pedidosSnap = await db.collection(`restaurantes/${restauranteId}/pedidos`)
    .where('creadoEn', '<', cutoffTimestamp)
    .get();

  // Acumular en memoria por día antes de escribir — un solo objeto de
  // incrementos por día, igual que hace la Cloud Function, para no pisar
  // campos del mismo día en escrituras separadas.
  const porDia = {};

  pedidosSnap.docs.forEach((doc) => {
    const p = doc.data();
    if (p.tipo === 'llamada') return; // las llamadas al mesero no son venta
    if (!p.creadoEn) return;

    const fecha = fechaLocalRD(p.creadoEn.toDate());
    if (!porDia[fecha]) {
      porDia[fecha] = { total: 0, subtotal: 0, itbis: 0, propina: 0, cantidadPedidos: 0, platos: {} };
    }
    const dia = porDia[fecha];
    dia.total += p.total || 0;
    dia.subtotal += p.subtotal || 0; // pedidos previos a impuestos configurables no tienen este campo
    dia.itbis += p.itbis || 0;
    dia.propina += p.propina || 0;
    dia.cantidadPedidos += 1;

    (p.items || []).forEach((item) => {
      // Pedidos anteriores a este fix no tienen item.platoId — se agrupan por
      // nombre como respaldo, para no perder el dato del ranking histórico.
      const clave = item.platoId || `nombre:${item.nombre}`;
      if (!dia.platos[clave]) dia.platos[clave] = { nombre: item.nombre, cantidad: 0 };
      dia.platos[clave].cantidad += 1;
    });
  });

  const fechas = Object.keys(porDia);
  for (const fecha of fechas) {
    const dia = porDia[fecha];
    const platosField = {};
    Object.entries(dia.platos).forEach(([clave, { nombre, cantidad }]) => {
      platosField[clave] = { nombre, cantidad: FieldValue.increment(cantidad) };
    });
    // merge:true + increment: si el script se corre más de una vez, o si ya
    // hay datos en vivo de después del deploy en ese día, esto SUMA en vez de
    // sobreescribir — nunca destruye datos ya agregados.
    await db.doc(`restaurantes/${restauranteId}/ventasDiarias/${fecha}`).set({
      total: FieldValue.increment(dia.total),
      subtotal: FieldValue.increment(dia.subtotal),
      itbis: FieldValue.increment(dia.itbis),
      propina: FieldValue.increment(dia.propina),
      cantidadPedidos: FieldValue.increment(dia.cantidadPedidos),
      platos: platosField,
    }, { merge: true });
  }

  await marcadorRef.set({
    completado: true,
    cutoff: cutoffTimestamp,
    terminadoEn: FieldValue.serverTimestamp(),
    pedidosProcesados: pedidosSnap.size,
    diasEscritos: fechas.length,
  });

  console.log(`[${restauranteId}] pedidos procesados: ${pedidosSnap.size} — días escritos: ${fechas.length}`);
}

async function main() {
  console.log(`Backfill de ventasDiarias — solo pedidos anteriores a ${cutoffDate.toISOString()}`);
  const restaurantesSnap = await db.collection('restaurantes').get();
  for (const doc of restaurantesSnap.docs) {
    try {
      await backfillRestaurante(doc.id);
    } catch (e) {
      console.error(`[${doc.id}] error durante el backfill:`, e.message);
    }
  }
  console.log('Backfill completado.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
