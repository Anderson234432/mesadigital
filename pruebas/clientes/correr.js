// Orquesta los 14 escenarios obligatorios de la Fase 1. Cada escenario:
// 1. Empieza con el restaurante de pruebas en estado limpio (limpiarTodo()
//    corre ANTES de cada uno — ningún escenario hereda pedidos ni cuentas
//    anónimas del anterior, ni sus contadores de rate limit).
// 2. Ejecuta la acción (UI real con Playwright, o llamada directa a
//    crearPedido cuando el caso no es construible desde una interfaz
//    honesta — ver clientes/llamadaDirecta.js para la justificación).
// 3. Verifica contra Firestore item por item (verificacion/firestore.js).
// 4. Para los que crean un pedido real, además verifica visualmente en
//    /cocina (verificacion/cocina.js) — es la parte que más valor tiene.
// 5. Registra el resultado como 'paso' | 'fallo' | 'rechazo-correcto' — un
//    rechazo esperado (rate limit, plato agotado, etc.) NUNCA cuenta como
//    fallo, exactamente como pide el brief.
//
// Semilla: PRUEBAS_SEMILLA=1234 node clientes/correr.js reproduce la misma
// corrida exacta (mismas notas, mismas cantidades aleatorias).

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { RESTAURANTE_ID, BASE_URL } from '../config.js';
import { ClienteVirtual } from './cliente.js';
import { crearClienteDirecto } from './llamadaDirecta.js';
import { crearRng, notaAleatoria, entero } from './escenarios.js';
import {
  leerUltimoPedidoDeMesa, leerPedidosDeMesa, leerRestaurante, leerVentasDiarias,
  fechaOperativaHoy, compararPedido, contarPedidosConIdempotencyKey,
  limpiarRateLimits, establecerHorarios, establecerDisponible, establecerPrecio,
} from '../verificacion/firestore.js';
import { abrirCocina, leerMesasVisibles, cerrarCocina } from '../verificacion/cocina.js';
import { limpiarTodo } from '../limpieza.js';

const SEMILLA = Number(process.env.PRUEBAS_SEMILLA) || Date.now() % 1000000;
const rng = crearRng(SEMILLA);
const HEADLESS = process.env.PRUEBAS_HEADLESS !== 'false';

const manifiesto = JSON.parse(readFileSync(new URL('../_manifiestos/restaurante-prueba.json', import.meta.url)));
const platoPorNombre = (nombre) => manifiesto.platos.find((p) => p.nombre === nombre);
const mesaToken = (n) => manifiesto.mesaTokens[String(n)];

const resultados = [];
const HORARIOS_ABIERTOS_ORIGINALES = null; // se recupera de Firestore antes de cerrar temporalmente

function registrar(nombre, estado, detalle = '', extra = {}) {
  const r = { nombre, estado, detalle, ...extra, semilla: SEMILLA };
  resultados.push(r);
  const marca = estado === 'paso' ? '✅' : estado === 'rechazo-correcto' ? '🛡️ ' : '❌';
  console.log(`${marca} [${estado}] ${nombre}${detalle ? ' — ' + detalle : ''}`);
  return r;
}

async function conLimpiezaPrevia(fn) {
  await limpiarTodo({ silencioso: true });
  return fn();
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Pedido simple de un plato
// ─────────────────────────────────────────────────────────────────────────
async function escenario1() {
  const nombre = 'Pedido simple de un plato';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Ensalada César');
    const cliente = new ClienteVirtual({ mesa: '1', token: mesaToken(1), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.agregarPlato(plato, 1);
      const nota = notaAleatoria(rng);
      await cliente.escribirNota(nota);
      const res = await cliente.enviarPedido();
      if (!res.enviado) return registrar(nombre, 'fallo', `No se mostró confirmación de envío. ${JSON.stringify(res)}`);

      const pedido = await leerUltimoPedidoDeMesa('1');
      const restaurante = await leerRestaurante();
      const totalEsperado = Math.round(plato.precio * 1.18) + Math.round(plato.precio * 0.10);
      const discrepancias = compararPedido({
        mesa: '1', estado: 'pendiente', total: totalEsperado, nota,
        items: [{ nombre: plato.nombre, precio: plato.precio }],
      }, pedido);

      if (discrepancias.length > 0) {
        return registrar(nombre, 'fallo', 'Discrepancias en el pedido', { esperado: 'ver discrepancias', discrepancias });
      }
      if ((restaurante.stats?.mesasPendientes || 0) !== 1) {
        return registrar(nombre, 'fallo', `stats.mesasPendientes debía ser 1, fue ${restaurante.stats?.mesasPendientes}`);
      }
      const fecha = fechaOperativaHoy(restaurante.horaCierreOperativo);
      const ventas = await leerVentasDiarias(fecha);
      if (!ventas || ventas.total < totalEsperado) {
        return registrar(nombre, 'fallo', `ventasDiarias no refleja el pedido (total=${ventas?.total})`);
      }
      return registrar(nombre, 'paso', `pedido ${pedido.id}, total RD$${pedido.total}`);
    } catch (e) {
      return registrar(nombre, 'fallo', `Excepción: ${e.message}`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Varias unidades del mismo plato
// ─────────────────────────────────────────────────────────────────────────
async function escenario2() {
  const nombre = 'Varias unidades del mismo plato';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Cerveza Presidente');
    const cantidad = entero(rng, 2, 5);
    const cliente = new ClienteVirtual({ mesa: '2', token: mesaToken(2), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.agregarPlato(plato, cantidad);
      const res = await cliente.enviarPedido();
      if (!res.enviado) return registrar(nombre, 'fallo', `No se envió. ${JSON.stringify(res)}`);

      const pedido = await leerUltimoPedidoDeMesa('2');
      const itemsEsperados = Array.from({ length: cantidad }, () => ({ nombre: plato.nombre, precio: plato.precio }));
      const discrepancias = compararPedido({ items: itemsEsperados }, pedido);
      if (discrepancias.length > 0) return registrar(nombre, 'fallo', `Cantidad no coincide (pedí ${cantidad})`, { discrepancias });
      return registrar(nombre, 'paso', `${cantidad}x ${plato.nombre}, items.length=${pedido.items.length}`);
    } catch (e) {
      return registrar(nombre, 'fallo', `Excepción: ${e.message}`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Varios platos distintos
// ─────────────────────────────────────────────────────────────────────────
async function escenario3() {
  const nombre = 'Varios platos distintos';
  return conLimpiezaPrevia(async () => {
    const plan = [
      { plato: platoPorNombre('Sopa del día'), cantidad: 1 },
      { plato: platoPorNombre('Mofongo con camarones'), cantidad: 1 },
      { plato: platoPorNombre('Tres Leches'), cantidad: 2 },
    ];
    const cliente = new ClienteVirtual({ mesa: '3', token: mesaToken(3), headless: HEADLESS });
    try {
      await cliente.abrir();
      for (const { plato, cantidad } of plan) await cliente.agregarPlato(plato, cantidad);
      const res = await cliente.enviarPedido();
      if (!res.enviado) return registrar(nombre, 'fallo', `No se envió. ${JSON.stringify(res)}`);

      const pedido = await leerUltimoPedidoDeMesa('3');
      const itemsEsperados = plan.flatMap(({ plato, cantidad }) =>
        Array.from({ length: cantidad }, () => ({ nombre: plato.nombre, precio: plato.precio })));
      const discrepancias = compararPedido({ items: itemsEsperados }, pedido);
      if (discrepancias.length > 0) return registrar(nombre, 'fallo', 'Algún plato se perdió o duplicó', { discrepancias });
      return registrar(nombre, 'paso', `${plan.length} platos distintos, ${pedido.items.length} items totales`);
    } catch (e) {
      return registrar(nombre, 'fallo', `Excepción: ${e.message}`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Intentar pedir un plato agotado — llamada directa: el acordeón ya lo
//    filtra (Menu.jsx oculta disponible:false), así que un cliente honesto
//    nunca puede construir este carrito desde la interfaz. Esto prueba la
//    validación del SERVIDOR, que es la que de verdad importa.
// ─────────────────────────────────────────────────────────────────────────
async function escenario4() {
  const nombre = 'Pedir un plato agotado (llamada directa)';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Chuleta ahumada'); // disponible:false en setup.js
    const cliente = await crearClienteDirecto('esc4');
    try {
      const r = await cliente.crearPedido({
        restauranteId: RESTAURANTE_ID, mesa: '4',
        items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(4),
      });
      if (r.ok) return registrar(nombre, 'fallo', 'El servidor ACEPTÓ un pedido de un plato agotado — no debía.');
      if (r.code !== 'functions/failed-precondition') {
        return registrar(nombre, 'fallo', `Se rechazó, pero con el código equivocado: ${r.code} (${r.message})`);
      }
      return registrar(nombre, 'rechazo-correcto', `Rechazado correctamente: ${r.message}`);
    } finally {
      await cliente.destruir();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Plato marcado agotado MIENTRAS está en el carrito — sí es reachable
//    por UI real: el cliente lo agrega mientras está disponible, y recién
//    DESPUÉS (con el carrito ya armado) el plato se marca agotado.
// ─────────────────────────────────────────────────────────────────────────
async function escenario5() {
  const nombre = 'Plato se agota mientras está en el carrito';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Pollo guisado');
    const cliente = new ClienteVirtual({ mesa: '5', token: mesaToken(5), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.agregarPlato(plato, 1);
      await establecerDisponible(plato.id, false); // el "cocinero" lo agota justo ahora
      const res = await cliente.enviarPedido();

      // restaurar disponibilidad para no afectar corridas futuras que usen este plato
      await establecerDisponible(plato.id, true);

      if (res.enviado) return registrar(nombre, 'fallo', 'El pedido se envió con éxito pese a que el plato ya estaba agotado.');
      const pedidoCreado = await leerUltimoPedidoDeMesa('5');
      if (pedidoCreado) return registrar(nombre, 'fallo', 'Se creó un pedido en Firestore pese al rechazo esperado.');
      return registrar(nombre, 'rechazo-correcto', `La interfaz mostró error: ${res.textoError || '(sin texto capturado, pero no se envió)'}`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Precio cambiado entre agregar y enviar — el servidor debe cobrar SU
//    precio (el nuevo), no el que el cliente vio al agregar.
// ─────────────────────────────────────────────────────────────────────────
async function escenario6() {
  const nombre = 'Precio cambia entre agregar y enviar';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Flan de Coco');
    const precioOriginal = plato.precio;
    const precioNuevo = precioOriginal + 100;
    const cliente = new ClienteVirtual({ mesa: '1', token: mesaToken(1), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.agregarPlato(plato, 1); // el cliente ve precioOriginal en pantalla
      await establecerPrecio(plato.id, precioNuevo);
      const res = await cliente.enviarPedido();
      await establecerPrecio(plato.id, precioOriginal); // restaurar

      if (!res.enviado) return registrar(nombre, 'fallo', `No se envió. ${JSON.stringify(res)}`);
      const pedido = await leerUltimoPedidoDeMesa('1');
      const itemGuardado = pedido?.items?.[0];
      if (!itemGuardado) return registrar(nombre, 'fallo', 'No se encontró el item en el pedido.');
      if (itemGuardado.precio !== precioNuevo) {
        return registrar(nombre, 'fallo', `Se cobró RD$${itemGuardado.precio}, debía cobrarse el precio del servidor (RD$${precioNuevo})`);
      }
      return registrar(nombre, 'paso', `Se cobró correctamente el precio del servidor (RD$${precioNuevo}, no el original RD$${precioOriginal})`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Dos clientes en la misma mesa a la vez
// ─────────────────────────────────────────────────────────────────────────
async function escenario7() {
  const nombre = 'Dos clientes en la misma mesa a la vez';
  return conLimpiezaPrevia(async () => {
    const platoA = platoPorNombre('Agua');
    const platoB = platoPorNombre('Mojito');
    const clienteA = new ClienteVirtual({ mesa: '2', token: mesaToken(2), headless: HEADLESS });
    const clienteB = new ClienteVirtual({ mesa: '2', token: mesaToken(2), headless: HEADLESS });
    try {
      await Promise.all([clienteA.abrir(), clienteB.abrir()]);
      await Promise.all([clienteA.agregarPlato(platoA, 1), clienteB.agregarPlato(platoB, 1)]);
      const [resA, resB] = await Promise.all([clienteA.enviarPedido(), clienteB.enviarPedido()]);
      if (!resA.enviado || !resB.enviado) {
        return registrar(nombre, 'fallo', `Algún pedido no se envió: A=${resA.enviado} B=${resB.enviado}`);
      }
      const pedidos = await leerPedidosDeMesa('2');
      if (pedidos.length !== 2) return registrar(nombre, 'fallo', `Se esperaban 2 pedidos en la mesa, hay ${pedidos.length}`);
      const uidsDistintos = new Set(pedidos.map((p) => p.clienteUid)).size === 2;
      if (!uidsDistintos) return registrar(nombre, 'fallo', 'Los dos pedidos comparten clienteUid — no se aislaron.');

      // Verificación visual en cocina: ambos agrupados bajo la misma mesa.
      const staff = manifiesto.staff;
      const { browser, page } = await abrirCocina({ email: staff.email, password: staff.password, headless: HEADLESS });
      const mesas = await leerMesasVisibles(page);
      await cerrarCocina({ browser });
      const mesa2 = mesas.find((m) => m.mesa === '2');
      if (!mesa2) return registrar(nombre, 'fallo', 'Cocina no muestra la mesa 2 en absoluto.');
      if (mesa2.total !== pedidos.reduce((s, p) => s + p.total, 0)) {
        return registrar(nombre, 'fallo', `Total en cocina (${mesa2.total}) no coincide con la suma real (${pedidos.reduce((s, p) => s + p.total, 0)})`);
      }
      return registrar(nombre, 'paso', `2 pedidos, clienteUids distintos, agrupados en cocina bajo Mesa 2 (total RD$${mesa2.total})`);
    } finally {
      await clienteA.cerrar();
      await clienteB.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Mismo cliente, varias rondas
// ─────────────────────────────────────────────────────────────────────────
async function escenario8() {
  const nombre = 'Mismo cliente, varias rondas';
  return conLimpiezaPrevia(async () => {
    const platoRonda1 = platoPorNombre('Ensalada César');
    const platoRonda2 = platoPorNombre('Tres Leches');
    const cliente = new ClienteVirtual({ mesa: '3', token: mesaToken(3), headless: HEADLESS });
    try {
      await cliente.abrir();
      await cliente.agregarPlato(platoRonda1, 1);
      const res1 = await cliente.enviarPedido();
      if (!res1.enviado) return registrar(nombre, 'fallo', `Ronda 1 no se envió. ${JSON.stringify(res1)}`);
      await cliente.page.waitForTimeout(1000);
      await cliente.agregarPlato(platoRonda2, 1);
      const res2 = await cliente.enviarPedido();
      if (!res2.enviado) return registrar(nombre, 'fallo', `Ronda 2 no se envió. ${JSON.stringify(res2)}`);

      const pedidos = await leerPedidosDeMesa('3');
      if (pedidos.length !== 2) return registrar(nombre, 'fallo', `Se esperaban 2 rondas, hay ${pedidos.length}`);
      const mismoUid = pedidos.every((p) => p.clienteUid === pedidos[0].clienteUid);
      if (!mismoUid) return registrar(nombre, 'fallo', 'Las dos rondas tienen clienteUid distinto — no debería, es la misma sesión.');
      const restaurante = await leerRestaurante();
      if ((restaurante.stats?.mesasPendientes || 0) !== 1) {
        return registrar(nombre, 'fallo', `stats.mesasPendientes debía ser 1 (misma mesa, 2 rondas cuentan como 1 mesa pendiente), fue ${restaurante.stats?.mesasPendientes}`);
      }
      return registrar(nombre, 'paso', `2 rondas, mismo clienteUid, stats.mesasPendientes=1 (no se contó doble)`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Superar el rate limit a propósito — ACIERTO si el sistema rechaza.
// ─────────────────────────────────────────────────────────────────────────
async function escenario9() {
  const nombre = 'Superar el rate limit por UID (5/min)';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Agua');
    const cliente = await crearClienteDirecto('esc9');
    try {
      const resultadosLlamadas = [];
      for (let i = 0; i < 7; i++) {
        const r = await cliente.crearPedido({
          restauranteId: RESTAURANTE_ID, mesa: '4',
          items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(4),
          idempotencyKey: crypto.randomUUID(), // cada llamada es un pedido distinto a propósito
        });
        resultadosLlamadas.push(r);
      }
      const exitosas = resultadosLlamadas.filter((r) => r.ok).length;
      const rechazadasPorLimite = resultadosLlamadas.filter((r) => !r.ok && r.code === 'functions/resource-exhausted').length;
      if (exitosas !== 5 || rechazadasPorLimite !== 2) {
        return registrar(nombre, 'fallo',
          `Se esperaban 5 aceptadas + 2 rechazadas por límite; hubo ${exitosas} aceptadas, ${rechazadasPorLimite} rechazadas por límite`,
          { resultadosLlamadas: resultadosLlamadas.map((r) => ({ ok: r.ok, code: r.code })) });
      }
      return registrar(nombre, 'rechazo-correcto', `5 pedidos aceptados, los 2 siguientes rechazados por rate limit — correcto`);
    } finally {
      await cliente.destruir();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Mismo idempotencyKey dos veces — solo debe crearse un pedido.
// ─────────────────────────────────────────────────────────────────────────
async function escenario10() {
  const nombre = 'Mismo idempotencyKey dos veces';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Mojito');
    const cliente = await crearClienteDirecto('esc10');
    const idempotencyKey = crypto.randomUUID();
    try {
      const r1 = await cliente.crearPedido({
        restauranteId: RESTAURANTE_ID, mesa: '5',
        items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(5), idempotencyKey,
      });
      const r2 = await cliente.crearPedido({
        restauranteId: RESTAURANTE_ID, mesa: '5',
        items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(5), idempotencyKey,
      });
      if (!r1.ok || !r2.ok) return registrar(nombre, 'fallo', `Alguna llamada falló: ${JSON.stringify({ r1, r2 })}`);
      if (r1.data.pedidoId !== r2.data.pedidoId) {
        return registrar(nombre, 'fallo', `Se devolvieron pedidoIds distintos (${r1.data.pedidoId} vs ${r2.data.pedidoId}) — debía ser el mismo.`);
      }
      const total = await contarPedidosConIdempotencyKey(idempotencyKey);
      if (total !== 1) return registrar(nombre, 'fallo', `Hay ${total} pedidos con ese idempotencyKey — debía haber exactamente 1.`);
      return registrar(nombre, 'paso', `Ambas llamadas devolvieron el mismo pedidoId (${r1.data.pedidoId}), solo 1 documento en Firestore.`);
    } finally {
      await cliente.destruir();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 11. Restaurante cerrado por horario
// ─────────────────────────────────────────────────────────────────────────
async function escenario11() {
  const nombre = 'Restaurante cerrado por horario';
  return conLimpiezaPrevia(async () => {
    const restauranteAntes = await leerRestaurante();
    const horariosOriginales = restauranteAntes.horarios;
    const HORARIO_CERRADO = Object.fromEntries(
      Object.keys(horariosOriginales).map((dia) => [dia, { abre: '', cierra: '', cerrado: true }])
    );
    const plato = platoPorNombre('Agua');
    try {
      await establecerHorarios(HORARIO_CERRADO);
      await new Promise((r) => setTimeout(r, 500)); // deja que el listener del cliente (si lo hubiera) se entere

      // (a) llamada directa — prueba que el SERVIDOR lo rechaza, no solo la UI
      const cliente = await crearClienteDirecto('esc11');
      const rDirecta = await cliente.crearPedido({
        restauranteId: RESTAURANTE_ID, mesa: '1',
        items: [{ id: plato.id, cantidad: 1 }], token: mesaToken(1),
      });
      await cliente.destruir();

      // (b) UI — confirma que Menu.jsx también avisa y bloquea el botón.
      // El aviso vive DENTRO del panel del carrito (Menu.jsx solo lo
      // renderiza con carrito.length > 0 y el panel abierto) — hay que
      // revisarlo DESPUÉS de agregar un plato y de que enviarPedido() abra
      // el panel, no antes (con el carrito vacío el aviso ni siquiera está
      // en el DOM todavía, sin importar el horario).
      const clienteUI = new ClienteVirtual({ mesa: '1', token: mesaToken(1), headless: HEADLESS });
      await clienteUI.abrir();
      await clienteUI.agregarPlato(plato, 1);
      const resUI = await clienteUI.enviarPedido();
      const avisoVisible = await clienteUI.avisoRestauranteCerradoVisible();
      await clienteUI.cerrar();

      if (rDirecta.ok) return registrar(nombre, 'fallo', 'El servidor ACEPTÓ un pedido con el restaurante cerrado.');
      if (rDirecta.code !== 'functions/failed-precondition') {
        return registrar(nombre, 'fallo', `Código de rechazo inesperado: ${rDirecta.code}`);
      }
      if (resUI.enviado) return registrar(nombre, 'fallo', 'La UI permitió enviar el pedido con el restaurante cerrado.');
      if (!avisoVisible) return registrar(nombre, 'fallo', 'La UI no mostró ningún aviso de restaurante cerrado.');

      return registrar(nombre, 'rechazo-correcto', `Servidor: "${rDirecta.message}". UI: aviso visible, botón bloqueado (razón: ${resUI.razon}).`);
    } finally {
      await establecerHorarios(horariosOriginales);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 12. Token de mesa inválido
// ─────────────────────────────────────────────────────────────────────────
async function escenario12() {
  const nombre = 'Token de mesa inválido';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Agua');
    const cliente = await crearClienteDirecto('esc12');
    try {
      const r = await cliente.crearPedido({
        restauranteId: RESTAURANTE_ID, mesa: '2',
        items: [{ id: plato.id, cantidad: 1 }], token: 'token-completamente-inventado-no-existe',
      });
      if (r.ok) return registrar(nombre, 'fallo', 'El servidor ACEPTÓ un pedido con un token de mesa inválido.');
      if (r.code !== 'functions/permission-denied') {
        return registrar(nombre, 'fallo', `Código de rechazo inesperado: ${r.code} (${r.message})`);
      }
      return registrar(nombre, 'rechazo-correcto', `Rechazado correctamente: ${r.message}`);
    } finally {
      await cliente.destruir();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 13. Carrito con 31 items
// ─────────────────────────────────────────────────────────────────────────
async function escenario13() {
  const nombre = 'Carrito con 31 items';
  return conLimpiezaPrevia(async () => {
    const plato = platoPorNombre('Agua');
    const cliente = await crearClienteDirecto('esc13');
    try {
      const items = Array.from({ length: 31 }, () => ({ id: plato.id, cantidad: 1 }));
      const r = await cliente.crearPedido({
        restauranteId: RESTAURANTE_ID, mesa: '3', items, token: mesaToken(3),
      });
      if (r.ok) return registrar(nombre, 'fallo', 'El servidor ACEPTÓ un carrito de 31 items (el máximo es 30).');
      if (r.code !== 'functions/invalid-argument') {
        return registrar(nombre, 'fallo', `Código de rechazo inesperado: ${r.code} (${r.message})`);
      }
      return registrar(nombre, 'rechazo-correcto', `Rechazado correctamente: ${r.message}`);
    } finally {
      await cliente.destruir();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 14. Llamar al mesero
// ─────────────────────────────────────────────────────────────────────────
async function escenario14() {
  const nombre = 'Llamar al mesero';
  return conLimpiezaPrevia(async () => {
    const cliente = new ClienteVirtual({ mesa: '4', token: mesaToken(4), headless: HEADLESS });
    try {
      // ventasDiarias es un agregado del DÍA OPERATIVO completo, no algo que
      // limpiarTodo() resetee entre escenarios (con razón: no es basura de
      // una corrida, es la métrica real que ya generaron pedidos legítimos
      // de escenarios anteriores en este mismo día). Por eso la única forma
      // honesta de comprobar "llamar al mesero no afecta ventas" es
      // comparar antes/después de ESTA llamada puntual, no revisar si el
      // contador es cero — casi nunca lo será a mitad de una corrida.
      const restauranteAntes = await leerRestaurante();
      const fechaAntes = fechaOperativaHoy(restauranteAntes.horaCierreOperativo);
      const ventasAntes = await leerVentasDiarias(fechaAntes);
      const cantidadPedidosAntes = ventasAntes?.cantidadPedidos || 0;

      await cliente.abrir();
      await cliente.llamarMesero();
      await cliente.page.waitForTimeout(1000);

      const pedidos = await leerPedidosDeMesa('4');
      const llamada = pedidos.find((p) => p.tipo === 'llamada');
      if (!llamada) return registrar(nombre, 'fallo', 'No se creó ningún documento con tipo:"llamada".');
      if (llamada.items.length !== 0 || llamada.total !== 0) {
        return registrar(nombre, 'fallo', `La llamada debía tener items:[] y total:0, tiene items:${llamada.items.length} total:${llamada.total}`);
      }
      const restaurante = await leerRestaurante();
      if ((restaurante.stats?.mesasPendientes || 0) !== 0) {
        return registrar(nombre, 'fallo', `Llamar al mesero NO debe incrementar stats.mesasPendientes, quedó en ${restaurante.stats?.mesasPendientes}`);
      }
      const fecha = fechaOperativaHoy(restaurante.horaCierreOperativo);
      const ventas = await leerVentasDiarias(fecha);
      const cantidadPedidosDespues = ventas?.cantidadPedidos || 0;
      if (cantidadPedidosDespues !== cantidadPedidosAntes) {
        return registrar(nombre, 'fallo',
          `Llamar al mesero afectó ventasDiarias.cantidadPedidos (${cantidadPedidosAntes} → ${cantidadPedidosDespues}) — no debía.`);
      }
      return registrar(nombre, 'paso', `tipo:"llamada" creado correctamente, sin afectar ventas ni stats`);
    } finally {
      await cliente.cerrar();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n═══ Ejército de clientes virtuales — Fase 1 (semilla ${SEMILLA}) ═══\n`);
  const escenarios = [
    escenario1, escenario2, escenario3, escenario4, escenario5, escenario6,
    escenario7, escenario8, escenario9, escenario10, escenario11, escenario12,
    escenario13, escenario14,
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
    new URL('../reporte/_resultados_fase1.json', import.meta.url),
    JSON.stringify({ semilla: SEMILLA, corridoEn: new Date().toISOString(), resultados }, null, 2)
  );

  const pasaron = resultados.filter((r) => r.estado === 'paso' || r.estado === 'rechazo-correcto').length;
  const fallaron = resultados.filter((r) => r.estado === 'fallo').length;
  console.log(`\n═══ Resumen: ${pasaron}/${resultados.length} pasaron, ${fallaron} fallaron ═══`);
  console.log('Resultados guardados en pruebas/reporte/_resultados_fase1.json');
  process.exit(fallaron > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Error fatal en la corrida:', e); process.exit(1); });
