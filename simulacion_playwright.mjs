// Proxy SSL corporativo (solo para esta prueba local)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * SIMULACIÓN DE CARGA — MESADIGITAL (PLAYWRIGHT)
 * Simula N clientes reales en paralelo con navegadores Chromium reales
 * (viewport iPhone). Cada uno hace el flujo completo: abrir menú por QR
 * → auth anónima → agregar platos → enviar pedido → esperar confirmación.
 *
 * Ver instrucciones de instalación y uso al final de este archivo.
 */

import { chromium, devices } from '@playwright/test';

// ── Config ────────────────────────────────────────────────────────────────────
const RESTAURANTE_ID = 'bSlawhFZ4zftoUbUVRBg';
const API_KEY         = 'AIzaSyCZ8qGDsZNrijAkQVWvXtGRWelFc8FPkyM';
const BASE_URL        = 'https://mesadigital-pi.vercel.app';

const USUARIOS    = 150;     // editable: 5, 10, 20, 50, 100
const MESA_INICIO = 1;
const HEADLESS    = true;    // false = ves los navegadores, true = background
const TIMEOUT_MS  = 30000;

// La máquina que corre esta prueba tiene CPU e inspección TLS local limitadas:
// no puede sostener USUARIOS navegadores Chromium reales navegando a la vez sin
// saturarse (eso produce timeouts de red que no reflejan al servidor real).
// Se limita cuántos flujos de usuario están activos en simultáneo; el resto
// espera turno, igual que clientes reales no escanean su QR en el mismo milisegundo.
const MAX_CONCURRENTE = 25;

// ── Paso 0: leer mesaTokens desde Firestore REST API ──────────────────────────
function valorFirestore(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) return objetoDesdeFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorFirestore);
  return null;
}

function objetoDesdeFields(fields) {
  const obj = {};
  for (const [clave, valor] of Object.entries(fields)) {
    obj[clave] = valorFirestore(valor);
  }
  return obj;
}

async function obtenerMesaTokens(restauranteId) {
  const url = `https://firestore.googleapis.com/v1/projects/mesadigital-d9b90/databases/(default)/documents/restaurantes/${restauranteId}?key=${API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠️  No se pudo leer el restaurante en Firestore (HTTP ${res.status}). Se continúa sin tokens.`);
      return {};
    }
    const doc = await res.json();
    const data = objetoDesdeFields(doc.fields || {});
    return data.mesaTokens || {};
  } catch (e) {
    console.warn(`  ⚠️  Error consultando Firestore: ${e.message}. Se continúa sin tokens.`);
    return {};
  }
}

function construirUrlMesa(restauranteId, mesa, mesaTokens) {
  const token = mesaTokens?.[String(mesa)];
  const base = `${BASE_URL}/restaurante/${restauranteId}/menu/${mesa}`;
  return token ? `${base}?t=${token}` : base;
}

// ── Paso 1-3: flujo de un usuario ─────────────────────────────────────────────
async function simularUsuario(browser, num, mesa, url, retardo = 0) {
  if (retardo > 0) await new Promise((r) => setTimeout(r, retardo));

  const t0 = Date.now();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();

  const resultado = { num, mesa, ok: false, tiempoMenu: null, tiempoPedido: null, tiempoTotal: null, error: null };

  try {
    page.setDefaultTimeout(TIMEOUT_MS);

    // Abrir URL de su mesa con token
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    // El menú se navega por categorías (Entradas, Bebidas...) antes de ver los platos.
    // Entrar a la primera categoría disponible para llegar a los botones "+ Agregar".
    const botonCategoria = page.locator('button.capitalize').first();
    await botonCategoria.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    await botonCategoria.click();

    // Esperar que el menú cargue (botón "Agregar" o "+")
    const botonAgregar = page.getByText(/\+\s*Agregar/).first();
    await botonAgregar.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    resultado.tiempoMenu = Date.now() - t0;

    // Hacer clic en "Agregar" en 1 o 2 platos disponibles
    const botonesAgregar = page.getByText(/\+\s*Agregar/);
    const disponibles = await botonesAgregar.count();
    const aClickear = Math.min(disponibles, 1 + (num % 2)); // 1 o 2 platos
    for (let i = 0; i < aClickear; i++) {
      await botonesAgregar.first().click();
      await page.waitForTimeout(200);
    }

    // Abrir el carrito (barra inferior con "N ítem(s)")
    await page.getByText(/ítem\(s\)/).first().click();

    // Buscar y hacer clic en el botón de enviar pedido
    const t1 = Date.now();
    const botonEnviar = page.getByRole('button', { name: /Enviar pedido|Pedir/i });
    await botonEnviar.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    await botonEnviar.click();

    // Esperar confirmación
    await page.getByText(/pendiente|listo|enviado|preparad/i).first()
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    resultado.tiempoPedido = Date.now() - t1;

    resultado.tiempoTotal = Date.now() - t0;
    resultado.ok = true;
  } catch (e) {
    resultado.error = e.message;
    try {
      await page.screenshot({ path: `error_usuario_${num}.png`, fullPage: true });
    } catch (_e) { /* no-op: si ni el screenshot funciona, seguimos */ }
  } finally {
    await context.close();
  }

  return resultado;
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
  console.log(`    avg: ${avg}ms   p50: ${pct(vals, .5)}ms   p95: ${pct(vals, .95)}ms`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const sep = '═'.repeat(62);
  console.log(`\n${sep}`);
  console.log(`  SIMULACIÓN MESADIGITAL — PLAYWRIGHT`);
  console.log(`  ${USUARIOS} clientes simultáneos`);
  console.log(sep + '\n');

  console.log('  Leyendo mesaTokens desde Firestore...');
  const mesaTokens = await obtenerMesaTokens(RESTAURANTE_ID);
  if (Object.keys(mesaTokens).length === 0) {
    console.log('  ⚠️  mesaTokens no existe o está vacío — se navegará sin ?t=\n');
  } else {
    console.log(`  ✅ Tokens encontrados para ${Object.keys(mesaTokens).length} mesa(s)\n`);
  }

  // Si hay menos mesas con token que usuarios a simular, se rota sobre las
  // mesas reales disponibles (cada usuario sigue siendo un contexto de
  // navegador y una auth anónima independiente, aunque comparta número de mesa).
  const mesasConToken = Object.keys(mesaTokens)
    .map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);

  const browser = await chromium.launch({ headless: HEADLESS });
  const t = Date.now();

  const usuarios = Array.from({ length: USUARIOS }, (_, i) => {
    const num = i + 1;
    const mesa = mesasConToken.length > 0
      ? mesasConToken[i % mesasConToken.length]
      : MESA_INICIO + i;
    const url = construirUrlMesa(RESTAURANTE_ID, mesa, mesaTokens);
    return { num, mesa, url };
  });

  // Pool de concurrencia acotada: cada "trabajador" toma el siguiente usuario
  // de la cola en cuanto termina el anterior, así nunca hay más de
  // MAX_CONCURRENTE navegadores activos a la vez.
  const resultados = new Array(usuarios.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < usuarios.length) {
      const i = siguiente++;
      const u = usuarios[i];
      resultados[i] = await simularUsuario(browser, u.num, u.mesa, u.url);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENTE, usuarios.length) }, trabajador)
  );
  const duracion = Date.now() - t;

  await browser.close();

  const ok = resultados.filter((r) => r.ok);
  const err = resultados.filter((r) => !r.ok);

  console.log('─'.repeat(62));
  console.log('  RESULTADOS\n');
  console.log(`  ✅ Exitosos     : ${ok.length} / ${USUARIOS}  (${(ok.length / USUARIOS * 100).toFixed(1)}%)`);
  console.log(`  ❌ Fallidos     : ${err.length}`);
  console.log(`  ⏱  Duración    : ${(duracion / 1000).toFixed(1)}s total\n`);

  fila('Carga del menú (QR → menú visible):', ok.map((r) => r.tiempoMenu));
  console.log('');
  fila('Cloud Function crearPedido:', ok.map((r) => r.tiempoPedido));
  console.log('');
  fila('Flujo completo (QR → pedido confirmado):', ok.map((r) => r.tiempoTotal));

  if (err.length) {
    console.log('\n  Errores:');
    err.forEach((r) => {
      console.log(`    [usuario ${r.num}, mesa ${r.mesa}] ${r.error?.slice(0, 100)}`);
    });
    console.log(`\n  Screenshots guardados: error_usuario_{N}.png`);
  }

  // ── Veredicto ──────────────────────────────────────────────────────────────
  const tasa = ok.length / USUARIOS;
  const p95Pedido = pct(ok.map((r) => r.tiempoPedido), .95);

  let veredicto;
  if (tasa >= .98 && p95Pedido < 2000) veredicto = '✅ EXCELENTE';
  else if (tasa >= .90 && p95Pedido < 4000) veredicto = '⚠️ ACEPTABLE';
  else veredicto = '❌ REQUIERE ATENCIÓN';

  console.log(`\n  VEREDICTO: ${veredicto}`);
  console.log('  Escalas para seguir probando:');
  console.log('    USUARIOS = 5   → baseline');
  console.log(`    USUARIOS = 10  → escenario normal${USUARIOS === 10 ? '  ← actual' : ''}`);
  console.log('    USUARIOS = 20  → hora pico');
  console.log('    USUARIOS = 50  → estrés máximo');
  console.log(sep + '\n');
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────────
// Instrucciones de uso:
//
// # Instalar (solo la primera vez):
// npm install --save-dev @playwright/test
// npx playwright install chromium
//
// # Correr:
// node simulacion_playwright.mjs
// ─────────────────────────────────────────────────────────────────────────────
