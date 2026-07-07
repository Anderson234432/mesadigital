// Proxy SSL corporativo (solo para esta prueba local)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * SIMULACIÓN DE CARGA — MESADIGITAL
 * Usa el Firebase SDK real (igual que el navegador).
 * Ejecutar: node simulacion.mjs
 */

import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ── Config ────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyCZ8qGDsZNrijAkQVWvXtGRWelFc8FPkyM',
  authDomain:        'mesadigital-d9b90.firebaseapp.com',
  projectId:         'mesadigital-d9b90',
  storageBucket:     'mesadigital-d9b90.firebasestorage.app',
  messagingSenderId: '66825226425',
  appId:             '1:66825226425:web:5299f7098c2f4ffc58f368',
};

const RESTAURANTE_ID      = 'bSlawhFZ4zftoUbUVRBg';
const PLATO_ID            = '0s5aCPXTWWj0q9ERcOOJ';
const USUARIOS_SIMULTANEOS = 100;   // ← cambia este número para cada prueba

// ── Simular un usuario ────────────────────────────────────────────────────────
async function simularUsuario(num, retardo = 0) {
  if (retardo > 0) await new Promise(r => setTimeout(r, retardo));

  // Cada usuario es una instancia Firebase independiente (como un teléfono distinto)
  const app  = initializeApp(firebaseConfig, `user_${num}_${Date.now()}`);
  const auth = getAuth(app);
  const fns  = getFunctions(app, 'us-central1');

  try {
    const t0 = Date.now();

    // Paso 1: Auth anónima → simula abrir el menú por QR
    const { user } = await signInAnonymously(auth);
    const msAuth = Date.now() - t0;

    // Paso 2: Enviar pedido → simula tocar "Enviar pedido"
    const crearPedido = httpsCallable(fns, 'crearPedido', { timeout: 30000 });
    const t1 = Date.now();
    await crearPedido({
      restauranteId:  RESTAURANTE_ID,
      mesa:           `sim_${num}`,
      items:          [{ id: PLATO_ID, cantidad: 1 }],
      nota:           '',
      clienteUid:     user.uid,
      idempotencyKey: `sim_${num}_${Date.now()}`,
    });
    const msPedido = Date.now() - t1;

    return { num, msAuth, msPedido, total: Date.now() - t0 };
  } finally {
    await deleteApp(app).catch(() => {});
  }
}

// ── Estadísticas ──────────────────────────────────────────────────────────────
function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(s.length * p) - 1)] ?? 0;
}

function fila(label, vals) {
  if (!vals.length) return;
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  console.log(`  ${label}`);
  console.log(`    avg ${avg}ms  |  p50 ${pct(vals,.5)}ms  |  p95 ${pct(vals,.95)}ms  |  p99 ${pct(vals,.99)}ms`);
  console.log(`    min ${Math.min(...vals)}ms  |  max ${Math.max(...vals)}ms`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sep = '═'.repeat(56);
  console.log(`\n${sep}`);
  console.log(`  SIMULACIÓN — ${USUARIOS_SIMULTANEOS} usuarios simultáneos`);
  console.log(sep + '\n');

  // Escalonar: rafagas de 10 usuarios cada 150ms para no saturar auth
  const BATCH = 10;
  const retardos = Array.from({ length: USUARIOS_SIMULTANEOS }, (_, i) =>
    Math.floor(i / BATCH) * 150
  );

  console.log(`  Lanzando en rafagas de ${BATCH} c/150ms...\n`);
  const t = Date.now();

  const res = await Promise.allSettled(
    retardos.map((r, i) => simularUsuario(i + 1, r))
  );

  const duracion = Date.now() - t;
  const ok  = res.filter(r => r.status === 'fulfilled').map(r => r.value);
  const err = res.filter(r => r.status === 'rejected');

  console.log('─'.repeat(56));
  console.log('  RESULTADOS\n');
  console.log(`  ✅  Exitosos  : ${ok.length} / ${USUARIOS_SIMULTANEOS}  (${(ok.length/USUARIOS_SIMULTANEOS*100).toFixed(1)}%)`);
  console.log(`  ❌  Fallidos  : ${err.length}`);
  console.log(`  ⏱   Total    : ${(duracion/1000).toFixed(1)}s\n`);

  fila('Auth anónima (escanear QR):', ok.map(r => r.msAuth));
  console.log('');
  fila('Cloud Function crearPedido:', ok.map(r => r.msPedido));
  console.log('');
  fila('Flujo completo QR → confirmado:', ok.map(r => r.total));

  if (err.length) {
    console.log('\n  Errores:');
    const conteo = {};
    err.forEach(r => {
      const m = r.reason?.message ?? 'Desconocido';
      const k = m.includes('exhausted') || m.includes('rate') ? '⛔ Rate limit'
              : m.includes('not-found')  ? '🔍 Plato/restaurante no existe'
              : m.includes('unavailable')? '🔌 Firebase no disponible'
              : m.includes('deadline')   ? '⏰ Timeout CF'
              : `⚠️  ${m.slice(0, 70)}`;
      conteo[k] = (conteo[k] || 0) + 1;
    });
    Object.entries(conteo).forEach(([k, n]) => console.log(`    [${n}x] ${k}`));
  }

  // ── Veredicto ──────────────────────────────────────────────────────────────
  const tasa = ok.length / USUARIOS_SIMULTANEOS;
  const p95  = pct(ok.map(r => r.msPedido), .95);

  let veredicto, detalle;
  if      (tasa >= .98 && p95 < 2000) { veredicto = '✅  EXCELENTE'; detalle = 'Sube a ' + USUARIOS_SIMULTANEOS*2 + ' usuarios y repite.'; }
  else if (tasa >= .95 && p95 < 3500) { veredicto = '✅  BUENO';     detalle = 'Funciona bien bajo esta carga.'; }
  else if (tasa >= .90 && p95 < 6000) { veredicto = '⚠️   MARGINAL'; detalle = 'Algunos usuarios esperan mucho. Este es el límite práctico.'; }
  else if (tasa >= .80)               { veredicto = '🟡  DEGRADADO'; detalle = 'Sistema bajo estrés visible.'; }
  else                                { veredicto = '❌  FALLA';     detalle = 'Demasiados errores para producción.'; }

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`\n  VEREDICTO: ${veredicto}`);
  console.log(`  ${detalle}\n`);

  if (ok.length) {
    const escala = Math.round(
      tasa >= .98 && p95 < 2000 ? USUARIOS_SIMULTANEOS * 4 :
      tasa >= .95               ? USUARIOS_SIMULTANEOS * 2 :
      tasa >= .90               ? USUARIOS_SIMULTANEOS * 1.2 :
                                  USUARIOS_SIMULTANEOS * 0.6
    );
    console.log(`  Capacidad estimada: ~${escala} usuarios simultáneos`);
  }
  console.log('\n' + sep + '\n');

  if (ok.length > 0) {
    console.log(`  ⚠️  Se crearon ${ok.length} pedidos de prueba (mesa sim_1…sim_${ok.length})`);
    console.log(`     Elimínalos en Firebase Console → Firestore si molestan.\n`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
