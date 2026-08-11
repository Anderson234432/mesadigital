// Horario semanal del restaurante — ¿está abierto ahora mismo?
//
// Por qué existe: la portada pública necesita mostrar "abierto/cerrado" en
// vivo, y Menu.jsx necesita poder deshabilitar el envío de pedidos fuera de
// horario (la validación real y definitiva vive en functions/lib/
// horarioRestaurante.js — esta copia del lado del cliente es solo para la
// experiencia de usuario, igual que el resto de la app). Las dos cosas usan
// el mismo cálculo de fondo (¿"ahora" cae dentro de alguna ventana horaria
// configurada?), pero con una diferencia importante: la portada muestra la
// hora REAL de cierre (para no mentirle al cliente), y el bloqueo de
// pedidos aplica un margen de gracia sobre esa hora (ver MARGEN_GRACIA_MIN
// más abajo) — por eso son dos funciones separadas que comparten la misma
// construcción de ventana horaria (calcularVentanas), parametrizada por el
// margen.
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
// por la misma razón documentada en fechaOperativa.js (dos paquetes de Node
// separados). Si cambias esta lógica, cambia también la copia del otro
// lado. Verificada con casos concretos — ver functions/lib/horarioRestaurante.js.

const OFFSET_RD_MS = 4 * 60 * 60 * 1000;
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MIN_POR_DIA = 24 * 60;

// Margen de gracia al CERRAR (no al abrir) — ver justificación completa en
// functions/lib/horarioRestaurante.js. 15 minutos.
export const MARGEN_GRACIA_MIN = 15;

export const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export function parsearHora(horaStr) {
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(horaStr || '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatHora12(horaStr) {
  const minutos = parsearHora(horaStr);
  if (minutos === null) return '';
  const h24 = Math.floor(minutos / 60);
  const min = minutos % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

function diaIndiceRD(timestampMs) {
  return Math.floor((timestampMs - OFFSET_RD_MS) / MS_POR_DIA);
}

function minutosTotalesRD(timestampMs) {
  return Math.floor((timestampMs - OFFSET_RD_MS) / (60 * 1000));
}

function nombreDiaPorIndice(diaIndice) {
  return DIAS[new Date(diaIndice * MS_POR_DIA).getUTCDay()];
}

function ventanaDeDia(diaIndice, horarioDelDia, margenGraciaMin) {
  if (!horarioDelDia || horarioDelDia.cerrado) return null;
  const abre = parsearHora(horarioDelDia.abre);
  const cierra = parsearHora(horarioDelDia.cierra);
  if (abre === null || cierra === null) return null;
  const inicio = diaIndice * MIN_POR_DIA + abre;
  const finBase = cierra > abre ? diaIndice * MIN_POR_DIA + cierra : (diaIndice + 1) * MIN_POR_DIA + cierra;
  return { inicio, fin: finBase + margenGraciaMin };
}

export function tieneHorarioConfigurado(horarios) {
  if (!horarios || typeof horarios !== 'object') return false;
  return DIAS.some((d) => parsearHora(horarios[d]?.abre) !== null && parsearHora(horarios[d]?.cierra) !== null);
}

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
// margen de gracia al cierre). Es solo para la experiencia de usuario
// (deshabilitar el botón) — la validación real vive en la Cloud Function.
export function puedeOrdenarAhora(horarios, ahoraMs) {
  if (!tieneHorarioConfigurado(horarios)) return true;
  return estaDentroDeVentana(horarios, ahoraMs, MARGEN_GRACIA_MIN);
}

// Para la píldora de la portada: estado detallado, SIN margen de gracia (la
// hora que se muestra es siempre la real, nunca la extendida). Devuelve
// null si no hay horario configurado.
export function calcularEstadoApertura(horarios, ahoraMs) {
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

  if (ventanaHoy && ahoraMin < ventanaHoy.inicio) {
    return {
      abierto: false,
      categoria: 'abreHoy',
      minutosFaltantes: ventanaHoy.inicio - ahoraMin,
      horaAbre: hoyH.abre,
    };
  }

  const hoyMarcadoCerrado = !!hoyH?.cerrado;

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

  return { abierto: false, categoria: 'sinProximaApertura' };
}

// Deriva horaCierreOperativo (functions/lib/fechaOperativa.js) a partir de
// `horarios` — evita pedirle al dueño el mismo dato dos veces. Solo del lado
// del cliente: nada en el servidor necesita derivar esto, horaCierreOperativo
// ya es lo que crearPedido/Admin.jsx leen directamente (ver Admin.jsx,
// handleGuardarHorarios).
//
// Lógica: de los días con horario configurado (no cerrados), solo importan
// los que cruzan medianoche (cierra <= abre). Sin ninguno, el cierre
// operativo es "00:00" (día de calendario normal). Con al menos uno, se
// toma el cierre MÁS TARDÍO entre esos días — es la única opción segura: si
// se tomara cualquier otro, una venta de un día con cierre más tardío que
// el elegido caería en el día operativo equivocado.
export function derivarHoraCierreOperativo(horarios) {
  if (!horarios || typeof horarios !== 'object') return '00:00';
  let cierreMasTardio = null; // minutos desde medianoche
  DIAS.forEach((dia) => {
    const h = horarios[dia];
    if (!h || h.cerrado) return;
    const abre = parsearHora(h.abre);
    const cierra = parsearHora(h.cierra);
    if (abre === null || cierra === null) return;
    if (cierra > abre) return; // no cruza medianoche, no participa en el cálculo
    if (cierreMasTardio === null || cierra > cierreMasTardio) cierreMasTardio = cierra;
  });
  if (cierreMasTardio === null) return '00:00';
  const h24 = Math.floor(cierreMasTardio / 60);
  const min = cierreMasTardio % 60;
  return `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
