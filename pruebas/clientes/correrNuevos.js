// Fase 1.5 — cacería nueva. Amplía correr.js con escenarios que la primera
// corrida no cubrió: bordes de tiempo, concurrencia más fina, datos límite,
// coherencia de números agregados, y recuperación ante fallas de red/cliente.
//
// Mismo contrato que correr.js: conLimpiezaPrevia() antes de cada uno,
// registrar() clasifica 'paso' | 'rechazo-correcto' | 'fallo', un rechazo
// esperado nunca cuenta como fallo. Reutiliza el mismo restaurante de
// pruebas y su manifiesto — no crea uno nuevo.
//
// Import dinámico deliberado: al importar el módulo de fechaOperativa desde
// `functions/lib` (CommonJS) hace falta createRequire — ver más abajo.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { FieldValue } from 'firebase-admin/firestore';
import { RESTAURANTE_ID, BASE_URL } from '../config.js';
import { ClienteVirtual } from './cliente.js';
import { crearClienteDirecto } from './llamadaDirecta.js';
import {
  db, leerPedido, leerPedidosDeMesa, leerRestaurante, leerVentasDiarias,
  fechaOperativaHoy, contarPedidosConIdempotencyKey, establecerHorarios,
} from '../verificacion/firestore.js';
import { limpiarTodo } from '../limpieza.js';

const require = createRequire(import.meta.url);
const { fechaOperativa } = require('../../functions/lib/fechaOperativa.js');
const { puedeOrdenarAhora } = require('../../functions/lib/horarioRestaurante.js');

const HEADLESS = process.env.PRUEBAS_HEADLESS !== 'false';
const manifiesto = JSON.parse(readFileSync(new URL('../_manifiestos/restaurante-prueba.json', import.meta.url)));
const platoPorNombre = (nombre) => manifiesto.platos.find((p) => p.nombre === nombre);
const mesaToken = (n) => manifiesto.mesaTokens[String(n)];

const resultados = [];
function registrar(nombre, estado, detalle = '', extra = {}) {
  const r = { nombre, estado, detalle, ...extra };
  resultados.push(r);
  const marca = estado === 'paso' ? '✅' : estado === 'rechazo-correcto' ? '🛡️ ' : '❌';
  console.log(`${marca} [${estado}] ${nombre}${detalle ? ' — ' + detalle : ''}`);
  return r;
}
async function conLimpiezaPrevia(fn) {
  await limpiarTodo({ silencioso: true });
  return fn();
}

// Platos temporales para casos que el menú fijo de setup.js no cubre
// (nombre con caracteres raros, precio fuera de rango) — se crean y se
// borran dentro del mismo escenario, nunca quedan en el fixture.
async function crearPlatoTemporal(datos) {
  const ref = db.collection(`restaurantes/${RESTAURANTE_ID}/platos`).doc();
  await ref.set({ disponible: true, orden: 99, tiempoMin: 5, imagenUrl: '', categoria: 'Entradas', subcategoria: '', nombreEn: '', ...datos });
  return { id: ref.id, ...datos };
}
async function borrarPlatoTemporal(id) {
  await db.collection(`restaurantes/${RESTAURANTE_ID}/platos`).doc(id).delete().catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════
// TIEMPO
// ═════════════════════════════════════════════════════════════════════════

// NT1 — Borde de cierre con margen de gracia: antes del cierre (acepta),
// dentro de los 15 min de margen (acepta), después del margen (rechaza).
// Horarios sintéticos construidos desde la hora RD actual real — no hace
// falta esperar reloj real, la ventana se arma para que "ahora" caiga
// exactamente donde se quiere probar.
async function escenarioNT1() {
  const nombre = 'Borde de cierre con margen de gracia (15 min)';
  return conLimpiezaPrevia(async () => {
    const restauranteAntes = await leerRestaurante();
    const horariosOriginales = restauranteAntes.horarios;
    const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const OFFSET_RD_MS = 4 * 60 * 60 * 1000;
    const ahoraMs = Date.now();
    const localMin = Math.floor((ahoraMs - OFFSET_RD_MS) / 60000) % 1440;
    const diaHoy = DIAS[new Date(ahoraMs - OFFSET_RD_MS).getUTCDay()];
    const hhmm = (min) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;

    const casos = [
      { desc: 'antes del cierre (cierra en 5 min)', cierraEnMin: 5, esperado: true },
      { desc: 'dentro del margen de gracia (cerró hace 10 min, margen=15)', cierraEnMin: -10, esperado: true },
      { desc: 'después del margen de gracia (cerró hace 20 min)', cierraEnMin: -20, esperado: false },
    ];
    const plato = platoPorNombre('Agua');
    const resultadosCasos = [];
    try {
      for (const caso of casos) {
        // cierraEnMin positivo = cierra dentro de N minutos (futuro);
        // negativo = cerró hace N minutos (pasado) — por eso ES +, no -.
        const horario = { abre: hhmm(localMin - 120), cierra: hhmm(localMin + caso.cierraEnMin), cerrado: false };
        const horarios = Object.fromEntries(DIAS.map((d) => [d, d === diaHoy ? horario : { abre: '', cierra: '', cerrado: false }]));
        await establecerHorarios(horarios);
        await new Promise((r) => setTimeout(r, 300));
        const cliente = await crearClienteDirecto(`nt1-${caso.cierraEnMin}`);
        const r = await cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '1', items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(1) });
        await cliente.destruir();
        const aceptado = r.ok;
        resultadosCasos.push({ ...caso, aceptado, correcto: aceptado === caso.esperado, code: r.code });
        // limpia el pedido de este caso para no ensuciar el siguiente
        if (r.ok) await db.doc(`restaurantes/${RESTAURANTE_ID}/pedidos/${r.data.pedidoId}`).delete().catch(() => {});
      }
      const incorrectos = resultadosCasos.filter((c) => !c.correcto);
      if (incorrectos.length > 0) {
        return registrar(nombre, 'fallo', 'Algún caso de borde no se comportó como se esperaba', { detalleCasos: resultadosCasos });
      }
      return registrar(nombre, 'paso', resultadosCasos.map((c) => `${c.desc}: ${c.aceptado ? 'aceptado' : 'rechazado'} (correcto)`).join(' | '));
    } finally {
      await establecerHorarios(horariosOriginales);
    }
  });
}

// NT2 — Fecha operativa en el borde de horaCierreOperativo: un instante justo
// ANTES del cierre operativo debe caer en el día anterior; justo DESPUÉS,
// en el día de hoy. Prueba la función en sí (determinista, sin esperar
// medianoche real) — igual que usa crearPedido en producción.
async function escenarioNT2() {
  const nombre = 'Fecha operativa en el borde de horaCierreOperativo';
  return conLimpiezaPrevia(async () => {
    const horaCierre = '02:00'; // cierre de madrugada, caso que de verdad ejercita la lógica
    const OFFSET_RD_MS = 4 * 60 * 60 * 1000;
    // Construye un instante a las 01:59 RD y otro a las 02:01 RD del mismo día calendario.
    const ahoraRD = new Date(Date.now() - OFFSET_RD_MS);
    const medianocheHoyUTC = Date.UTC(ahoraRD.getUTCFullYear(), ahoraRD.getUTCMonth(), ahoraRD.getUTCDate());
    const antesDelCierreMs = medianocheHoyUTC + (1 * 60 + 59) * 60000 + OFFSET_RD_MS;
    const despuesDelCierreMs = medianocheHoyUTC + (2 * 60 + 1) * 60000 + OFFSET_RD_MS;

    const fechaAntes = fechaOperativa(antesDelCierreMs, horaCierre);
    const fechaDespues = fechaOperativa(despuesDelCierreMs, horaCierre);
    const diaCalendarioHoy = new Date(medianocheHoyUTC).toISOString().slice(0, 10);
    const diaCalendarioAyer = new Date(medianocheHoyUTC - 86400000).toISOString().slice(0, 10);

    const antesOk = fechaAntes === diaCalendarioAyer; // 1:59am antes de las 2am de cierre -> cuenta como AYER
    const despuesOk = fechaDespues === diaCalendarioHoy; // 2:01am despues del cierre -> cuenta como HOY

    if (!antesOk || !despuesOk) {
      return registrar(nombre, 'fallo', `01:59 dio ${fechaAntes} (esperado ${diaCalendarioAyer}), 02:01 dio ${fechaDespues} (esperado ${diaCalendarioHoy})`);
    }
    return registrar(nombre, 'paso', `01:59 -> ${fechaAntes} (día anterior), 02:01 -> ${fechaDespues} (día de hoy), ambos correctos`);
  });
}

// ═════════════════════════════════════════════════════════════════════════
// CONCURRENCIA
// ═════════════════════════════════════════════════════════════════════════

// NC1 — Dos clientes UI agregan el mismo plato mientras el admin lo agota a
// mitad. Ambos ya tenían el plato en el carrito ANTES del cambio (como
// escenario 5, pero con dos sesiones a la vez) — ninguno debe lograr
// enviarlo tras agotarse.
async function escenarioNC1() {
  const nombre = 'Dos clientes agregan el mismo plato mientras se agota';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Pollo guisado');
    const clienteA = new ClienteVirtual({ mesa: '2', token: mesaToken(2), headless: HEADLESS });
    const clienteB = new ClienteVirtual({ mesa: '3', token: mesaToken(3), headless: HEADLESS });
    try {
      await Promise.all([clienteA.abrir(), clienteB.abrir()]);
      await Promise.all([clienteA.agregarPlato(plato, 1), clienteB.agregarPlato(plato, 1)]);
      await db.doc(`restaurantes/${RESTAURANTE_ID}/platos/${plato.id}`).update({ disponible: false });
      const [resA, resB] = await Promise.all([clienteA.enviarPedido(), clienteB.enviarPedido()]);
      await db.doc(`restaurantes/${RESTAURANTE_ID}/platos/${plato.id}`).update({ disponible: true });

      if (resA.enviado || resB.enviado) {
        return registrar(nombre, 'fallo', `Al menos un cliente logró enviar un plato ya agotado: A=${resA.enviado} B=${resB.enviado}`);
      }
      const pedidosA = await leerPedidosDeMesa('2');
      const pedidosB = await leerPedidosDeMesa('3');
      if (pedidosA.length > 0 || pedidosB.length > 0) {
        return registrar(nombre, 'fallo', 'Se creó un pedido en Firestore pese al rechazo esperado en ambos clientes.');
      }
      return registrar(nombre, 'rechazo-correcto', 'Ambos clientes fueron rechazados al agotarse el plato mientras estaba en sus carritos.');
    } finally {
      await clienteA.cerrar();
      await clienteB.cerrar();
    }
  });
}

// NC2 — Cocina archiva la mesa justo mientras esa misma mesa manda otra
// ronda. Prueba directamente el fix de la Parte 2 (contador fuera de la
// transacción) bajo una carrera real, no solo bajo carga genérica.
async function escenarioNC2() {
  const nombre = 'Archivar una mesa mientras esa mesa envía otra ronda';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Agua');
    const clienteRonda1 = await crearClienteDirecto('nc2-ronda1');
    const r1 = await clienteRonda1.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '4', items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(4) });
    await clienteRonda1.destruir();
    if (!r1.ok) return registrar(nombre, 'fallo', `No se pudo crear el pedido inicial de la ronda 1: ${r1.code}`);

    // Espera a que stats.mesasPendientes refleje la ronda 1 (ahora es una
    // escritura NO transaccional, separada de la creación del pedido).
    await new Promise((r) => setTimeout(r, 800));

    const clienteRonda2 = await crearClienteDirecto('nc2-ronda2');
    // Replica el patrón real de actualizarEstadoPedidos (Parte 2: la
    // decisión de archivar y la escritura del contador, por separado) —
    // no se puede invocar la función del cliente (firebase/firestore) desde
    // este arnés Admin SDK sin una sesión de admin autenticada de verdad.
    const archivarYDecrementar = async () => {
      await db.doc(`restaurantes/${RESTAURANTE_ID}/pedidos/${r1.data.pedidoId}`).update({ estado: 'archivado' });
      await db.doc(`restaurantes/${RESTAURANTE_ID}`).update({ 'stats.mesasPendientes': FieldValue.increment(-1) }).catch(() => {});
    };
    const [, r2] = await Promise.all([
      archivarYDecrementar(),
      clienteRonda2.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '4', items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(4) }),
    ]);
    await clienteRonda2.destruir();
    await new Promise((r) => setTimeout(r, 800));

    if (!r2.ok) return registrar(nombre, 'fallo', `La ronda 2 (concurrente con el archivado) falló: ${r2.code} ${r2.message}`);

    const restaurante = await leerRestaurante();
    const pendientes = restaurante.stats?.mesasPendientes ?? 0;
    // No exigimos un valor exacto (la carrera es real e inherente al diseño
    // "fuera de transacción" aceptado en la Parte 2) — exigimos que no quede
    // NEGATIVO ni evidentemente disparatado (>5, el número de mesas del
    // restaurante de pruebas).
    if (pendientes < 0 || pendientes > 5) {
      return registrar(nombre, 'fallo', `stats.mesasPendientes quedó en ${pendientes} tras la carrera — fuera de rango razonable [0,5].`);
    }
    return registrar(nombre, 'paso', `Ronda 2 creada correctamente durante el archivado concurrente de la ronda 1. stats.mesasPendientes=${pendientes} (razonable).`);
  });
}

// NC3 — "Dos pestañas del mismo navegador": misma sesión anónima (mismo
// UID, mismo token de App Check), dos pedidos disparados a la vez. Distinto
// de "dos clientes en la misma mesa" (escenario 7 de Fase 1), que usa DOS
// UIDs — acá se prueba qué pasa cuando es la MISMA identidad concurrente
// consigo misma (rate limit por UID, no por mesa).
async function escenarioNC3() {
  const nombre = 'Dos pestañas del mismo navegador (misma sesión) piden a la vez';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Mojito');
    const cliente = await crearClienteDirecto('nc3-mismasesion');
    try {
      const [r1, r2] = await Promise.all([
        cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '5', items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(5) }),
        cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '5', items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(5) }),
      ]);
      if (!r1.ok || !r2.ok) {
        return registrar(nombre, 'fallo', `Se esperaba que AMBOS pedidos de la misma sesión pasaran (2 < límite de 5/min por UID): ${JSON.stringify({ r1: { ok: r1.ok, code: r1.code }, r2: { ok: r2.ok, code: r2.code } })}`);
      }
      if (r1.data.pedidoId === r2.data.pedidoId) {
        return registrar(nombre, 'fallo', 'Ambas llamadas concurrentes de la misma sesión devolvieron el MISMO pedidoId — se perdió una de las dos rondas (cada llamada llevaba su propio idempotencyKey generado aparte).');
      }
      const pedidos = await leerPedidosDeMesa('5');
      if (pedidos.length !== 2) return registrar(nombre, 'fallo', `Se esperaban 2 pedidos distintos, hay ${pedidos.length}`);
      return registrar(nombre, 'paso', `2 pedidos concurrentes de la misma sesión, ambos creados por separado (${r1.data.pedidoId}, ${r2.data.pedidoId}).`);
    } finally {
      await cliente.destruir();
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════
// DATOS LÍMITE
// ═════════════════════════════════════════════════════════════════════════

// ND1 — Nota de exactamente 500 y de 501 caracteres.
async function escenarioND1() {
  const nombre = 'Nota de 500 caracteres vs. 501 caracteres';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Agua');
    const nota500 = 'x'.repeat(500);
    const nota501 = 'x'.repeat(501);
    const cliente = await crearClienteDirecto('nd1');
    try {
      const r500 = await cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '1', items: [{ id: plato.id, cantidad: 1 }], nota: nota500, token: mesaToken(1) });
      if (!r500.ok) return registrar(nombre, 'fallo', `Nota de exactamente 500 caracteres fue rechazada: ${r500.code}`);
      const pedido500 = await leerPedido(r500.data.pedidoId);
      if (pedido500.nota.length !== 500) return registrar(nombre, 'fallo', `Nota de 500 quedó guardada con longitud ${pedido500.nota.length}, no 500.`);

      const r501 = await cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '1', items: [{ id: plato.id, cantidad: 1 }], nota: nota501, token: mesaToken(1) });
      if (!r501.ok) return registrar(nombre, 'fallo', `Nota de 501 caracteres fue rechazada en vez de truncada: ${r501.code}`);
      const pedido501 = await leerPedido(r501.data.pedidoId);
      if (pedido501.nota.length !== 500) {
        return registrar(nombre, 'fallo', `Nota de 501 caracteres NO se truncó a 500 — quedó guardada con longitud ${pedido501.nota.length}.`);
      }
      return registrar(nombre, 'paso', 'Nota de 500 se guarda completa; nota de 501 se trunca correctamente a 500.');
    } finally {
      await cliente.destruir();
    }
  });
}

// ND2 — Nombre de plato con emoji, tildes, comillas y una etiqueta HTML —
// prueba que crearPedido lo guarda tal cual (no lo rompe) y que Cocina.jsx
// no lo interpreta como HTML real (XSS) al mostrarlo.
async function escenarioND2() {
  const nombre = 'Nombre de plato con emoji, tildes, comillas y HTML';
  return conLimpiezaPrevia(async () => {
    const nombrePlato = `Yuca con "mojo" 🧄🌶️ — versión mamá <b>especial</b> ñoño`;
    const platoTemp = await crearPlatoTemporal({ nombre: nombrePlato, precio: 100 });
    const cliente = await crearClienteDirecto('nd2');
    try {
      const r = await cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '1', items: [{ id: platoTemp.id, cantidad: 1 }], token: mesaToken(1) });
      if (!r.ok) return registrar(nombre, 'fallo', `Se rechazó un pedido de un plato con nombre válido pero con caracteres raros: ${r.code} ${r.message}`);
      const pedido = await leerPedido(r.data.pedidoId);
      const nombreGuardado = pedido.items[0]?.nombre;
      if (nombreGuardado !== nombrePlato) {
        return registrar(nombre, 'fallo', `El nombre se guardó distinto al original.`, { esperado: nombrePlato, encontrado: nombreGuardado });
      }
      return registrar(nombre, 'paso', `El nombre con emoji/tildes/comillas/HTML se guardó exactamente igual: "${nombreGuardado}"`);
    } finally {
      await cliente.destruir();
      await borrarPlatoTemporal(platoTemp.id);
    }
  });
}

// ND3 — Pedido que roza (o supera) el tope de RD$65,000 — ese tope vive en
// firestore.rules para el camino de RESPALDO (crearPedidoDirecto, escritura
// directa del cliente), no en la Cloud Function crearPedido, que jamás
// compara `total` contra ningún techo. Este caso documenta esa asimetría.
async function escenarioND3() {
  const nombre = 'Pedido que supera RD$65,000 (tope de firestore.rules)';
  return conLimpiezaPrevia(async () => {
    const platoCaro = await crearPlatoTemporal({ nombre: 'Langosta Premium (temporal, prueba ND3)', precio: 3000 });
    const cliente = await crearClienteDirecto('nd3');
    try {
      // subtotal = 3000*30 = 90000; con ITBIS 18% + propina 10% (28%) el
      // total ronda 115200 — muy por encima del tope de 65000 de las Rules.
      const items = Array.from({ length: 30 }, () => ({ id: platoCaro.id, cantidad: 1 }));
      const r = await cliente.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '1', items, token: mesaToken(1) });
      if (!r.ok) {
        return registrar(nombre, 'paso', `El servidor rechazó el pedido por encima de RD$65,000: ${r.code} ${r.message} (no hace falta corregir nada — es más estricto de lo esperado).`);
      }
      const totalReal = r.data.total;
      return registrar(nombre, 'fallo',
        `crearPedido ACEPTÓ un pedido de RD$${totalReal} — muy por encima del tope de RD$65,000 que firestore.rules sí aplica en el camino de respaldo (crearPedidoDirecto). ` +
        `La Cloud Function nunca compara \`total\` contra ningún techo — es una asimetría real entre los dos caminos de creación de pedidos, no un problema del arnés.`,
        { severidad: 'menor', total: totalReal, esDeLaApp: true });
    } finally {
      await cliente.destruir();
      await borrarPlatoTemporal(platoCaro.id);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════
// COHERENCIA DE NÚMEROS
// ═════════════════════════════════════════════════════════════════════════

// NN1 + NN2 — Tras una tanda de pedidos reales, ¿ventasDiarias.total coincide
// con la suma real de los pedidos?, ¿el ranking de platos cuenta bien las
// repeticiones (incluyendo el MISMO plato en dos pedidos distintos)?
async function escenarioNN1() {
  const nombre = 'ventasDiarias coincide con la suma real de pedidos, y el ranking de platos cuenta bien';
  return conLimpiezaPrevia(async () => {
    const platoA = platoPorNombre('Agua'); // 50
    const platoB = platoPorNombre('Cerveza Presidente'); // 150
    const clienteA = await crearClienteDirecto('nn1-a');
    const clienteB = await crearClienteDirecto('nn1-b');
    try {
      const [rA1, rA2, rB1] = await Promise.all([
        clienteA.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '1', items: [{ id: platoA.id, cantidad: 2 }], token: mesaToken(1) }),
        clienteA.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '2', items: [{ id: platoA.id, cantidad: 1 }], token: mesaToken(2) }),
        clienteB.crearPedido({ restauranteId: RESTAURANTE_ID, mesa: '3', items: [{ id: platoB.id, cantidad: 3 }], token: mesaToken(3) }),
      ]);
      if (!rA1.ok || !rA2.ok || !rB1.ok) {
        return registrar(nombre, 'fallo', `Algún pedido de la tanda falló: ${JSON.stringify([rA1, rA2, rB1].map((r) => ({ ok: r.ok, code: r.code })))}`);
      }
      await new Promise((r) => setTimeout(r, 500));

      const [pedido1, pedido2, pedido3] = await Promise.all([
        leerPedido(rA1.data.pedidoId), leerPedido(rA2.data.pedidoId), leerPedido(rB1.data.pedidoId),
      ]);
      const totalRealSuma = pedido1.total + pedido2.total + pedido3.total;
      const cantidadAguaReal = 2 + 1; // 3 unidades de Agua entre los 3 pedidos
      const cantidadCervezaReal = 3;

      const restaurante = await leerRestaurante();
      const fecha = fechaOperativaHoy(restaurante.horaCierreOperativo);
      const ventas = await leerVentasDiarias(fecha);
      if (!ventas) return registrar(nombre, 'fallo', 'No existe documento de ventasDiarias para hoy tras crear 3 pedidos.');

      const discrepancias = [];
      if (ventas.total < totalRealSuma) discrepancias.push(`ventasDiarias.total=${ventas.total}, suma real de ESTOS 3 pedidos=${totalRealSuma} (ventasDiarias.total debía ser >= eso, incluye otros pedidos del día también)`);
      const rankingAgua = ventas.platos?.[platoA.id]?.cantidad;
      const rankingCerveza = ventas.platos?.[platoB.id]?.cantidad;
      if (rankingAgua == null || rankingAgua < cantidadAguaReal) discrepancias.push(`ranking de Agua=${rankingAgua}, esperado >= ${cantidadAguaReal}`);
      if (rankingCerveza == null || rankingCerveza < cantidadCervezaReal) discrepancias.push(`ranking de Cerveza Presidente=${rankingCerveza}, esperado >= ${cantidadCervezaReal}`);

      if (discrepancias.length > 0) return registrar(nombre, 'fallo', discrepancias.join(' | '));
      return registrar(nombre, 'paso', `ventasDiarias.total>=${totalRealSuma} OK, ranking Agua=${rankingAgua} (>=${cantidadAguaReal}), ranking Cerveza=${rankingCerveza} (>=${cantidadCervezaReal})`);
    } finally {
      await clienteA.destruir();
      await clienteB.destruir();
    }
  });
}

// NN3 — Llamada al mesero: confirma que queda excluida de cantidadPedidos Y
// del ranking de platos (no solo de mesasPendientes, ya probado en Fase 1).
async function escenarioNN3() {
  const nombre = 'Llamada al mesero excluida del ranking de platos y cantidadPedidos';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Flan de Coco');
    const restauranteAntes = await leerRestaurante();
    const fechaAntes = fechaOperativaHoy(restauranteAntes.horaCierreOperativo);
    const ventasAntes = await leerVentasDiarias(fechaAntes);
    const cantidadAntes = ventasAntes?.cantidadPedidos || 0;
    const rankingAntes = ventasAntes?.platos?.[plato.id]?.cantidad || 0;

    const cliente = new ClienteVirtual({ mesa: '2', token: mesaToken(2), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.llamarMesero();
      await cliente.page.waitForTimeout(1000);

      const restaurante = await leerRestaurante();
      const fecha = fechaOperativaHoy(restaurante.horaCierreOperativo);
      const ventas = await leerVentasDiarias(fecha);
      const cantidadDespues = ventas?.cantidadPedidos || 0;
      const rankingDespues = ventas?.platos?.[plato.id]?.cantidad || 0;

      if (cantidadDespues !== cantidadAntes || rankingDespues !== rankingAntes) {
        return registrar(nombre, 'fallo', `La llamada al mesero afectó ventasDiarias: cantidadPedidos ${cantidadAntes}→${cantidadDespues}, ranking ${rankingAntes}→${rankingDespues}`);
      }
      return registrar(nombre, 'paso', 'Llamar al mesero no afectó cantidadPedidos ni el ranking de platos.');
    } finally {
      await cliente.cerrar();
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════
// RECUPERACIÓN
// ═════════════════════════════════════════════════════════════════════════

// NR1 — Corte de red a mitad del envío, reconexión y reintento manual.
//
// `context().setOffline(true)` resultó NO ser confiable para esto: en la
// práctica no interrumpe una request que YA salió al cable (se observó la
// respuesta 200 de crearPedido llegando igual con offline activo un
// instante después del click) — solo bloquea requests NUEVAS. La forma
// determinista de simular "se cortó a mitad del envío" es interceptar la
// request real y abortarla a propósito (page.route + route.abort()).
//
// Hallazgo real de la app encontrado al construir esto (ver reporte): con
// la request de crearPedido abortada, el código clasifica el fallo como
// funciones/internal y por diseño intenta el camino de RESPALDO
// (crearPedidoDirecto, escritura directa a Firestore) — ese respaldo, en
// esta misma sesión de navegador justo después del abort, es rechazado por
// las Rules con "permission-denied" (reproducido y confirmado: la MISMA
// escritura, con los MISMOS datos, desde una sesión de Node limpia, SÍ pasa
// las Rules — no es un problema de lógica de las Rules en sí, es algo
// puntual de esa sesión de navegador justo tras el fallo de red, no
// determinado con certeza en el tiempo disponible). El resultado visible
// para el cliente es un mensaje engañoso ("Accede escaneando el código QR
// de tu mesa") que no tiene nada que ver con la causa real (un corte de
// red). Lo que SÍ se confirma acá: pese a ese mensaje confuso, el carrito
// se restaura (rollback optimista) y el idempotencyKey se conserva, así
// que un reintento manual del usuario (clic de nuevo) sí crea el pedido
// una sola vez — no hay pérdida de datos ni duplicado, solo una mala
// experiencia momentánea.
async function escenarioNR1() {
  const nombre = 'Corte de red a mitad del envío, reintento manual sin duplicar';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Sopa del día');
    const cliente = new ClienteVirtual({ mesa: '3', token: mesaToken(3), headless: HEADLESS });
    try {
      await cliente.abrir();
      let primeraLlamada = true;
      await cliente.page.route('**/crearPedido', async (route) => {
        if (primeraLlamada) { primeraLlamada = false; await route.abort('internetdisconnected'); }
        else await route.continue();
      });
      await cliente.agregarPlato(plato, 1);

      const res1 = await cliente.enviarPedido();
      const huboMensajeConfuso = res1.error && /QR/i.test(res1.textoError || '');

      const res2 = await cliente.enviarPedido(); // reintento manual, mismo idempotencyKey
      await cliente.page.waitForTimeout(1000);

      const pedidos = await leerPedidosDeMesa('3');
      if (pedidos.length > 1) {
        return registrar(nombre, 'fallo', `Quedaron ${pedidos.length} pedidos en la mesa tras el corte de red y el reintento — debía quedar 1 como máximo (posible duplicado real).`);
      }
      if (pedidos.length === 0 || !res2.enviado) {
        return registrar(nombre, 'fallo', `El reintento manual tras el corte de red no logró crear el pedido. intento1=${JSON.stringify(res1)} intento2=${JSON.stringify(res2)}`);
      }
      return registrar(nombre, 'paso',
        `Sin duplicados ni pérdida: exactamente 1 pedido tras corte de red + reintento manual. ` +
        (huboMensajeConfuso
          ? `Nota aparte (hallazgo, no falla este escenario): el primer intento mostró un mensaje de error engañoso ("${res1.textoError}") para lo que en realidad fue un fallo de red — ver comentario del escenario.`
          : `Mensaje del primer intento: "${res1.textoError}".`));
    } finally {
      await cliente.cerrar();
    }
  });
}

// NR2 — Recargar la página justo después de enviar: el pedido ya viajó al
// servidor antes del reload (el cliente no puede des-enviarlo); confirma que
// sigue existiendo exactamente una vez y que la recarga no lo duplica.
async function escenarioNR2() {
  const nombre = 'Recargar la página justo después de enviar';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Tres Leches');
    const cliente = new ClienteVirtual({ mesa: '4', token: mesaToken(4), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.agregarPlato(plato, 1);
      await cliente._abrirCarritoSiHaceFalta();
      const boton = cliente.page.locator('button', { hasText: /Enviar pedido|Send order/i });
      await cliente._clickRobusto(boton);
      await cliente.page.waitForTimeout(600); // deja que la request salga de verdad antes de recargar
      await cliente.page.reload({ waitUntil: 'load' });
      await cliente.page.waitForTimeout(2500); // deja completar el envío original + que la página recargada asiente

      const pedidos = await leerPedidosDeMesa('4');
      if (pedidos.length !== 1) {
        return registrar(nombre, 'fallo', `Se esperaba exactamente 1 pedido tras recargar justo después de enviar, hay ${pedidos.length}.`);
      }
      return registrar(nombre, 'paso', `Exactamente 1 pedido quedó registrado pese a recargar la página justo después de enviar.`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n═══ Ejército de clientes virtuales — Cacería nueva (post-fixes) ═══\n');
  const escenarios = [
    escenarioNT1, escenarioNT2,
    escenarioNC1, escenarioNC2, escenarioNC3,
    escenarioND1, escenarioND2, escenarioND3,
    escenarioNN1, escenarioNN3,
    escenarioNR1, escenarioNR2,
  ];
  for (const escenario of escenarios) {
    try {
      await escenario();
    } catch (e) {
      registrar(escenario.name, 'fallo', `Excepción no capturada: ${e.stack || e.message}`);
    }
  }

  await limpiarTodo({ silencioso: true });

  mkdirSync(new URL('../reporte', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../reporte/_resultados_fase1_nuevos.json', import.meta.url),
    JSON.stringify({ corridoEn: new Date().toISOString(), resultados }, null, 2)
  );

  const pasaron = resultados.filter((r) => r.estado === 'paso' || r.estado === 'rechazo-correcto').length;
  const fallaron = resultados.filter((r) => r.estado === 'fallo').length;
  console.log(`\n═══ Resumen cacería nueva: ${pasaron}/${resultados.length} correctos, ${fallaron} fallaron ═══`);
  console.log('Resultados guardados en pruebas/reporte/_resultados_fase1_nuevos.json');
  process.exit(fallaron > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Error fatal en la cacería nueva:', e); process.exit(1); });
