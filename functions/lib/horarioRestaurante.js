// Horario semanal del restaurante — ¿está abierto ahora mismo?
//
// Por qué existe: la portada pública necesita mostrar "abierto/cerrado" en
// vivo, y crearPedido necesita poder rechazar pedidos fuera de horario. Las
// dos cosas usan el mismo cálculo de fondo (¿"ahora" cae dentro de alguna
// ventana horaria configurada?), pero con una diferencia importante: la
// portada muestra la hora REAL de cierre (para no mentirle al cliente), y el
// bloqueo de pedidos aplica un margen de gracia sobre esa hora (ver
// MARGEN_GRACIA_MIN más abajo) — por eso son dos funciones separadas que
// comparten la misma construcción de ventana horaria (calcularVentanas),
// parametrizada por el margen.
//
// Cruce de medianoche: un horario como { abre: "17:00", cierra: "02:00" }
// significa que la ventana de ESE día empieza a las 5:00 PM y termina a las
// 2:00 AM del día calendario SIGUIENTE. Se detecta comparando los minutos:
// si cierra <= abre, la ventana cruza a la medianoche.
//
// Además de "hoy", siempre hay que revisar la ventana de AYER — si ayer
// cerraba a las 2:00 AM cruzando medianoche, esa ventana sigue vigente
// durante la madrugada de HOY hasta que llegue esa hora.
//
// República Dominicana: UTC-4 fijo todo el año — mismo offset que
// fechaOperativa.js. Duplicado a propósito entre functions/lib/ y src/utils/
// por la misma razón documentada ahí (dos paquetes de Node separados, sin
// forma de compartir un archivo sin meter un paquete compartido). Si cambias
// esta lógica, cambia también la copia del otro lado.

const OFFSET_RD_MS = 4 * 60 * 60 * 1000;
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MIN_POR_DIA = 24 * 60;

// Margen de gracia al CERRAR (no al abrir): si el restaurante cierra a las
// 2:00 AM y alguien envía el pedido a las 2:00:30, rechazarlo es agresivo —
// la cocina normalmente sigue atendiendo unos minutos después de la hora de
// cierre nominal. 15 minutos es suficiente para cubrir ese margen real sin
// abrir la puerta a pedir de madrugada con el restaurante genuinamente
// cerrado. No aplica al abrir: no hay razón para dejar pedir ANTES de la
// hora de apertura.
const MARGEN_GRACIA_MIN = 15;

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// "17:00" → 1020. Entradas inválidas/ausentes → null (día sin horario válido).
function parsearHora(horaStr) {
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(horaStr || '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatHora12(horaStr) {
  const minutos = parsearHora(horaStr);
  if (minutos === null) return '';
  const h24 = Math.floor(minutos / 60);
  const min = minutos % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

// Índice de día RD (entero, sube exactamente en la medianoche de RD) — mismo
// truco que fechaOperativa.js: se resta el offset y se trabaja con los
// getters UTC del Date resultante como si fueran hora local de RD.
function diaIndiceRD(timestampMs) {
  return Math.floor((timestampMs - OFFSET_RD_MS) / MS_POR_DIA);
}

// Minutos totales desde época, en hora de RD — combina día y hora en un solo
// entero continuo, así comparar "¿ahora cae dentro de esta ventana?" es una
// simple comparación numérica sin manejar día y hora por separado.
function minutosTotalesRD(timestampMs) {
  return Math.floor((timestampMs - OFFSET_RD_MS) / (60 * 1000));
}

function nombreDiaPorIndice(diaIndice) {
  // new Date(diaIndice * MS_POR_DIA) cae exactamente en la medianoche UTC de
  // ese día — getUTCDay() da el día de la semana correcto porque diaIndice ya
  // está en "días desde época en hora de RD" (ver diaIndiceRD).
  return DIAS[new Date(diaIndice * MS_POR_DIA).getUTCDay()];
}

// Ventana [inicio, fin) en minutos-totales-RD para el horario de un día
// dado, con un margen de gracia opcional sumado al cierre. null si el día no
// tiene horario válido o está marcado cerrado.
function ventanaDeDia(diaIndice, horarioDelDia, margenGraciaMin) {
  if (!horarioDelDia || horarioDelDia.cerrado) return null;
  const abre = parsearHora(horarioDelDia.abre);
  const cierra = parsearHora(horarioDelDia.cierra);
  if (abre === null || cierra === null) return null;
  const inicio = diaIndice * MIN_POR_DIA + abre;
  // cierra <= abre → cruza medianoche, la ventana termina el día siguiente.
  const finBase = cierra > abre ? diaIndice * MIN_POR_DIA + cierra : (diaIndice + 1) * MIN_POR_DIA + cierra;
  return { inicio, fin: finBase + margenGraciaMin };
}

// ¿Tiene ESTE día una configuración real? Sí si está marcado cerrado
// (aunque no tenga horas — "cerrado" ES la configuración, no la ausencia de
// una) o si tiene abre/cierra válidos.
function diaTieneConfiguracion(horarioDelDia) {
  if (!horarioDelDia) return false;
  if (horarioDelDia.cerrado) return true;
  return parsearHora(horarioDelDia.abre) !== null && parsearHora(horarioDelDia.cierra) !== null;
}

// ¿Hay algún horario real configurado? (al menos un día marcado cerrado, o
// con abre/cierra válidos). Si no hay nada, ni la portada ni el bloqueo de
// pedidos deben aplicar restricción alguna.
//
// Antes exigía abre/cierra parseables sin importar `cerrado` — un día
// marcado cerrado con horas vacías (la forma más natural de cerrar por
// vacaciones: tocar el toggle, no inventar horas) no contaba como
// "configurado". Con los 7 días así, tieneHorarioConfigurado daba false y
// puedeOrdenarAhora asumía "sin restricción" — el restaurante quedaba
// SIEMPRE ABIERTO pese a que el dueño marcó todos los días como cerrados.
function tieneHorarioConfigurado(horarios) {
  if (!horarios || typeof horarios !== 'object') return false;
  return DIAS.some((d) => diaTieneConfiguracion(horarios[d]));
}

// Núcleo compartido: ¿"ahora" cae dentro de la ventana de hoy o el arrastre
// de ayer (con margen de gracia opcional)?
function estaDentroDeVentana(horarios, ahoraMs, margenGraciaMin) {
  const ahoraMin = minutosTotalesRD(ahoraMs);
  const hoyIdx = diaIndiceRD(ahoraMs);

  const ventanaHoy = ventanaDeDia(hoyIdx, horarios[nombreDiaPorIndice(hoyIdx)], margenGraciaMin);
  if (ventanaHoy && ahoraMin >= ventanaHoy.inicio && ahoraMin < ventanaHoy.fin) return true;

  const ventanaAyer = ventanaDeDia(hoyIdx - 1, horarios[nombreDiaPorIndice(hoyIdx - 1)], margenGraciaMin);
  if (ventanaAyer && ahoraMin >= ventanaAyer.inicio && ahoraMin < ventanaAyer.fin) return true;

  return false;
}

// Para bloquear pedidos: true si no hay horario configurado (sin
// restricción) o si "ahora" cae dentro de alguna ventana abierta (con el
// margen de gracia al cierre).
function puedeOrdenarAhora(horarios, ahoraMs) {
  if (!tieneHorarioConfigurado(horarios)) return true;
  return estaDentroDeVentana(horarios, ahoraMs, MARGEN_GRACIA_MIN);
}

// Para la píldora de la portada: estado detallado, SIN margen de gracia (la
// hora que se muestra es siempre la real, nunca la extendida).
// Devuelve null si no hay horario configurado — la portada no debe mostrar
// nada en ese caso.
function calcularEstadoApertura(horarios, ahoraMs) {
  if (!tieneHorarioConfigurado(horarios)) return null;

  const ahoraMin = minutosTotalesRD(ahoraMs);
  const hoyIdx = diaIndiceRD(ahoraMs);
  const hoyNombre = nombreDiaPorIndice(hoyIdx);
  const ayerNombre = nombreDiaPorIndice(hoyIdx - 1);
  const hoyH = horarios[hoyNombre];
  const ayerH = horarios[ayerNombre];

  const ventanaHoy = ventanaDeDia(hoyIdx, hoyH, 0);
  if (ventanaHoy && ahoraMin >= ventanaHoy.inicio && ahoraMin < ventanaHoy.fin) {
    return { abierto: true, horaCierra: hoyH.cierra };
  }
  const ventanaAyer = ventanaDeDia(hoyIdx - 1, ayerH, 0);
  if (ventanaAyer && ahoraMin >= ventanaAyer.inicio && ahoraMin < ventanaAyer.fin) {
    return { abierto: true, horaCierra: ayerH.cierra };
  }

  // No está abierto. ¿Todavía puede abrir hoy? (hoy tiene horario válido, no
  // cerrado, y su ventana arranca más tarde)
  if (ventanaHoy && ahoraMin < ventanaHoy.inicio) {
    return {
      abierto: false,
      categoria: 'abreHoy',
      minutosFaltantes: ventanaHoy.inicio - ahoraMin,
      horaAbre: hoyH.abre,
    };
  }

  const hoyMarcadoCerrado = !!hoyH?.cerrado;

  // Buscar la próxima apertura desde mañana en adelante (hasta 7 días —
  // cubre cualquier combinación de días cerrados).
  for (let i = 1; i <= 7; i++) {
    const idx = hoyIdx + i;
    const nombre = nombreDiaPorIndice(idx);
    const h = horarios[nombre];
    if (h && !h.cerrado && parsearHora(h.abre) !== null) {
      return {
        abierto: false,
        categoria: hoyMarcadoCerrado ? 'cerradoHoy' : 'otroDia',
        diasAdelante: i,
        horaAbre: h.abre,
        nombreDiaApertura: nombre,
      };
    }
  }

  // Todos los días marcados cerrados — caso extremo, pero no debe romper nada.
  return { abierto: false, categoria: 'sinProximaApertura' };
}

module.exports = {
  DIAS,
  MARGEN_GRACIA_MIN,
  parsearHora,
  formatHora12,
  tieneHorarioConfigurado,
  puedeOrdenarAhora,
  calcularEstadoApertura,
};
