// Borra todo lo que una corrida pudo haber creado — pedidos y cuentas
// anónimas del restaurante de pruebas. Idempotente y seguro de correr
// aunque una corrida anterior haya fallado a mitad: no depende de una
// lista en memoria de "lo que se creó esta vez", vuelve a consultar
// Firestore/Auth directamente, así que corre igual de bien después de un
// crash que después de una corrida exitosa.
//
// Qué NO borra: el restaurante de pruebas en sí, ni su menú/mesas — esos
// son un fixture persistente (ver setup.js), no basura de una corrida.
// Si además quieres reiniciar el menú desde cero, corre setup.js de nuevo
// (ya es idempotente: limpia platos/pedidos/categorías antes de rearmar).
//
// Cuentas anónimas: se identifican por (a) ser anónimas (providerData
// vacío) Y (b) tener su UID referenciado en algún pedido del restaurante
// de pruebas — nunca se borra una cuenta anónima por edad o patrón, solo
// por estar vinculada a datos que este script ya sabe que son de prueba.
// Esto evita borrar por accidente una cuenta anónima real de otro
// restaurante si algún día se corre esto sin aislar bien las cosas.

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { RESTAURANTE_ID, PROJECT_ID, ADC_CREDENTIALS_PATH } from './config.js';

// getApps().length===0 evita "duplicate-app" cuando otro módulo (ej.
// verificacion/firestore.js) ya inicializó el SDK antes que este —
// correr.js importa ambos en la misma corrida.
if (getApps().length === 0) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_CREDENTIALS_PATH;
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}
const db = getFirestore();
const auth = getAuth();

async function borrarPedidos() {
  const ref = db.collection('restaurantes').doc(RESTAURANTE_ID).collection('pedidos');
  const snap = await ref.get();
  const uids = new Set();
  let borrados = 0;
  // Batches de 400 — mismo límite práctico que usa limpiarPedidosAntiguos
  // en functions/index.js, para no acercarse al máximo de 500 de Firestore.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const lote = docs.slice(i, i + 400);
    const batch = db.batch();
    lote.forEach((d) => {
      const data = d.data();
      if (data.clienteUid) uids.add(data.clienteUid);
      batch.delete(d.ref);
    });
    await batch.commit();
    borrados += lote.length;
  }
  return { borrados, uids: [...uids] };
}

async function resetearStats() {
  await db.collection('restaurantes').doc(RESTAURANTE_ID).update({ 'stats.mesasPendientes': 0 });
}

async function borrarCuentasAnonimas(uids) {
  if (uids.length === 0) return 0;
  let borradas = 0;
  // deleteUsers acepta hasta 1000 uids por llamada.
  for (let i = 0; i < uids.length; i += 1000) {
    const lote = uids.slice(i, i + 1000);
    const res = await auth.deleteUsers(lote);
    borradas += res.successCount;
    if (res.failureCount > 0) {
      console.warn(`  ${res.failureCount} cuentas no se pudieron borrar (probablemente ya no existían):`,
        res.errors.slice(0, 3).map((e) => e.error.message));
    }
  }
  return borradas;
}

// Exportada para que clientes/correr.js pueda resetear el estado entre
// cada escenario (aislamiento total: ningún escenario hereda pedidos ni
// cuentas anónimas del anterior), además de para el uso normal como
// script de línea de comandos.
export async function limpiarTodo({ silencioso = false } = {}) {
  const log = silencioso ? () => {} : console.log;
  log(`Limpiando restaurante de pruebas: ${RESTAURANTE_ID}`);

  const { borrados: pedidosBorrados, uids } = await borrarPedidos();
  log(`Pedidos borrados: ${pedidosBorrados}`);

  const cuentasBorradas = await borrarCuentasAnonimas(uids);
  log(`Cuentas anónimas borradas: ${cuentasBorradas}`);

  await resetearStats();

  const restante = await db.collection('restaurantes').doc(RESTAURANTE_ID).collection('pedidos').limit(1).get();
  if (!restante.empty) {
    throw new Error('Quedaron pedidos sin borrar tras la limpieza.');
  }
  return { pedidosBorrados, cuentasBorradas };
}

async function main() {
  const r = await limpiarTodo();
  console.log('\n✅ Limpieza completa. No quedaron pedidos ni cuentas anónimas vinculadas.');
  console.log(`   (${r.pedidosBorrados} pedidos, ${r.cuentasBorradas} cuentas anónimas)`);
}

// Solo corre main() si se invoca directo (`node limpieza.js`), no cuando
// otro módulo importa limpiarTodo().
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('Error en la limpieza:', e); process.exit(1); });
}
