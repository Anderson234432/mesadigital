// Fase 2 — carga: ¿aguanta MesaDigital clientes concurrentes reales, y dónde
// exactamente se rompe? No usa navegador — un navegador por cliente no
// escala a 500 (sería 500 procesos Chromium), y la Fase 1 ya probó que la
// interfaz en sí funciona; acá lo que se mide es la Cloud Function y
// Firestore bajo carga, no el acordeón. Cada cliente simulado sigue siendo
// una identidad real: sesión anónima propia + token de mesa válido +
// App Check real (vía clientes/llamadaDirecta.js), igual que Fase 1.
//
// ¿Por qué Node y no k6? k6 corre sus scripts en goja (un runtime JS propio,
// sin Node ni npm) — no puede importar el SDK de Firebase, así que replicar
// lo que ya hace llamadaDirecta.js (canje de token de depuración de App
// Check, sign-in anónimo, protocolo de Callable Functions) tocaría
// reimplementar ese protocolo a mano sobre HTTP crudo en un runtime
// limitado, solo para volver a llegar adonde ya está el harness de Node.
// A cambio, 500 llamadas HTTP concurrentes son trabajo I/O-bound trivial
// para el event loop de Node — no hay ninguna limitación real de throughput
// que k6 resolviera acá. k6 se justificaría con miles de req/s sostenidos o
// un protocolo simple sin SDK; no es este caso.
//
// Cada "ola" de N clientes se lanza toda de una vez (sin límite de
// concurrencia de nuestro lado) — el objetivo es encontrar el punto de
// quiebre real del sistema, no suavizarlo. Los clientes se reparten entre
// las mesas del restaurante de pruebas (round-robin), así que a partir de
// cierto N el rate limit por mesa (10/60s, ver crearPedido en
// functions/index.js) empieza a rechazar de forma esperada — eso cuenta
// como "rechazo correcto", nunca como fallo real.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { crearClienteDirecto } from '../clientes/llamadaDirecta.js';
import { RESTAURANTE_ID } from '../config.js';
import { limpiarTodo } from '../limpieza.js';
import { leerRestaurante, auth as adminAuth } from '../verificacion/firestore.js';

const manifiesto = JSON.parse(readFileSync(new URL('../_manifiestos/restaurante-prueba.json', import.meta.url)));
const plato = manifiesto.platos.find((p) => p.nombre === 'Agua'); // barato, siempre disponible, sin subcategoría — irrelevante para carga
const NUM_MESAS = Object.keys(manifiesto.mesaTokens).length;

const NIVELES = process.env.PRUEBAS_NIVELES_CARGA
  ? process.env.PRUEBAS_NIVELES_CARGA.split(',').map(Number)
  : [10, 50, 100, 500];

function percentil(valores, p) {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[idx];
}

// Códigos que el propio diseño del sistema espera bajo carga concentrada —
// nunca son "el sistema se rompió", son "el sistema se defendió". Cualquier
// otro código (o una excepción no capturada) sí es un fallo real a mirar.
const CODIGOS_RECHAZO_ESPERADO = new Set(['functions/resource-exhausted']);

// Crear N sesiones anónimas + intercambio de token de App Check a la vez
// satura el límite de conexiones salientes de ESTA máquina (confirmado en
// la corrida real: a 100 concurrentes, signInAnonymously empezó a fallar
// con "fetch failed" — un límite del equipo de pruebas, no del servidor).
// La medición que importa es crearPedido bajo concurrencia real, no cuántas
// sesiones puede abrir Node a la vez — por eso solo la CREACIÓN de clientes
// se hace en lotes acotados; una vez creados, TODAS las llamadas a
// crearPedido salen juntas, sin ningún límite artificial de este lado.
const LOTE_CREACION_CLIENTES = 30;

async function crearClientesEnLotes(n) {
  const clientes = [];
  let noCreados = 0;
  for (let i = 0; i < n; i += LOTE_CREACION_CLIENTES) {
    const lote = await Promise.all(
      Array.from({ length: Math.min(LOTE_CREACION_CLIENTES, n - i) }, (_, j) =>
        crearClienteDirecto(`carga-${n}-${i + j}-${Math.random().toString(36).slice(2)}`).catch(() => null)
      )
    );
    for (const c of lote) {
      if (c) clientes.push(c); else noCreados++;
    }
  }
  return { clientes, noCreados };
}

async function unaOla(n) {
  const { clientes, noCreados } = await crearClientesEnLotes(n);
  const inicioOla = Date.now();
  const resultados = await Promise.all(
    clientes.map((cliente, i) => {
      const mesaNum = (i % NUM_MESAS) + 1;
      return cliente.crearPedido({
        restauranteId: RESTAURANTE_ID,
        mesa: String(mesaNum),
        items: [{ id: plato.id, cantidad: 1 }],
        token: manifiesto.mesaTokens[String(mesaNum)],
      }).then((r) => ({ ...r, mesa: mesaNum }));
    })
  );
  const duracionOlaMs = Date.now() - inicioOla;

  // Limpieza propia: limpiarTodo() (llamada por correrNivel) solo borra
  // cuentas anónimas VINCULADAS a un pedido — un cliente rechazado por rate
  // limit nunca llega a crear pedido, así que su cuenta anónima quedaría
  // huérfana para siempre si no se borra explícitamente acá.
  const uids = clientes.map((c) => c.uid);
  await Promise.all(clientes.map((c) => c.destruir().catch(() => {})));

  return { resultados, duracionOlaMs, uids, noCreados };
}

async function borrarCuentasDeLaOla(uids) {
  for (let i = 0; i < uids.length; i += 1000) {
    const lote = uids.slice(i, i + 1000);
    await adminAuth.deleteUsers(lote).catch(() => {});
  }
}

async function correrNivel(n) {
  await limpiarTodo({ silencioso: true });
  const { resultados, duracionOlaMs, uids, noCreados } = await unaOla(n);
  await borrarCuentasDeLaOla(uids);

  const exitosos = resultados.filter((r) => r.ok);
  const rechazosEsperados = resultados.filter((r) => !r.ok && CODIGOS_RECHAZO_ESPERADO.has(r.code));
  const fallosReales = resultados.filter((r) => !r.ok && !CODIGOS_RECHAZO_ESPERADO.has(r.code));

  const latenciasExitosas = exitosos.map((r) => r.ms);
  const medianaMs = percentil(latenciasExitosas, 50);
  const p95Ms = percentil(latenciasExitosas, 95);
  const p99Ms = percentil(latenciasExitosas, 99);
  const maxMs = latenciasExitosas.length ? Math.max(...latenciasExitosas) : null;

  // Heurística de cold start / contención en Firestore: no hay forma de
  // saberlo con certeza sin leer los logs de Cloud Functions (fuera de
  // alcance de este script), pero una petición que tarda mucho más que la
  // mediana de su propia ola es una señal razonable de una u otra — se
  // reporta como candidato, no como diagnóstico confirmado.
  const umbralOutlier = medianaMs ? medianaMs * 3 : null;
  const outliers = umbralOutlier ? latenciasExitosas.filter((ms) => ms > umbralOutlier).length : 0;

  // stats.mesasPendientes debe reflejar cuántas mesas DISTINTAS lograron al
  // menos un pedido — no cuántos pedidos hubo en total (varios pedidos
  // exitosos en la misma mesa cuentan como 1 mesa pendiente).
  const mesasConExito = new Set(exitosos.map((r) => r.mesa));
  const restaurante = await leerRestaurante();
  const mesasPendientesReal = restaurante.stats?.mesasPendientes || 0;
  const statsCorrectos = mesasPendientesReal === mesasConExito.size;

  return {
    nivel: n,
    duracionOlaMs,
    total: resultados.length,
    clientesNoCreados: noCreados,
    exitosos: exitosos.length,
    rechazosEsperados: rechazosEsperados.length,
    fallosReales: fallosReales.length,
    medianaMs, p95Ms, p99Ms, maxMs,
    outliersLatencia: outliers,
    mesasPendientesEsperado: mesasConExito.size,
    mesasPendientesReal,
    statsCorrectos,
    muestraFallosReales: fallosReales.slice(0, 8).map((r) => ({ code: r.code, message: r.message, ms: r.ms })),
    codigosRechazoEsperado: [...new Set(rechazosEsperados.map((r) => r.code))],
  };
}

async function main() {
  console.log(`\n═══ Ejército de clientes virtuales — Fase 2 (carga) — niveles: ${NIVELES.join(', ')} ═══\n`);
  const resultadosPorNivel = [];
  let puntoDeQuiebre = null;

  for (const n of NIVELES) {
    console.log(`→ Nivel: ${n} clientes concurrentes...`);
    const r = await correrNivel(n);
    resultadosPorNivel.push(r);
    console.log(`  ${r.exitosos}/${r.total} exitosos, ${r.rechazosEsperados} rechazos esperados (rate limit), ${r.fallosReales} fallos reales`
      + (r.clientesNoCreados > 0 ? ` (${r.clientesNoCreados} sesiones no se pudieron crear — límite del equipo de pruebas, no del servidor)` : ''));
    console.log(`  latencia (éxitos, ms): mediana=${r.medianaMs} p95=${r.p95Ms} p99=${r.p99Ms} max=${r.maxMs} — outliers(>3x mediana)=${r.outliersLatencia}`);
    console.log(`  stats.mesasPendientes: esperado=${r.mesasPendientesEsperado} real=${r.mesasPendientesReal} ${r.statsCorrectos ? 'OK' : '❌ DESAJUSTADO'}`);
    if (r.fallosReales > 0) {
      console.log(`  muestra de fallos reales:`, JSON.stringify(r.muestraFallosReales, null, 2));
      if (!puntoDeQuiebre) puntoDeQuiebre = n;
    }
    if (!r.statsCorrectos && !puntoDeQuiebre) puntoDeQuiebre = n;
    console.log('');
  }

  // El último nivel deja sus propios pedidos exitosos en Firestore —
  // correrNivel() limpia ANTES de cada nivel (para partir de estado
  // limpio), pero nadie limpia DESPUÉS del último. Limpieza obligatoria
  // también si la corrida se interrumpe a mitad (ver limpiarTodo, que no
  // depende de qué se creó en memoria).
  await limpiarTodo({ silencioso: true });

  mkdirSync(new URL('../reporte', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../reporte/_resultados_fase2.json', import.meta.url),
    JSON.stringify({ corridoEn: new Date().toISOString(), niveles: resultadosPorNivel, puntoDeQuiebre }, null, 2)
  );

  console.log(`═══ Punto de quiebre: ${puntoDeQuiebre ? `${puntoDeQuiebre} clientes concurrentes` : 'no se encontró dentro de los niveles probados'} ═══`);
  console.log('Resultados guardados en pruebas/reporte/_resultados_fase2.json');
}

main().catch((e) => { console.error('Error fatal en la carga:', e); process.exit(1); });
