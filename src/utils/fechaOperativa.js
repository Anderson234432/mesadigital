// Día operativo configurable por restaurante.
//
// Por qué existe: ningún restaurante cierra a medianoche — muchos sirven
// hasta la madrugada. Contar las ventas por fecha de calendario hace que un
// pedido del domingo a la 1:30 AM se registre como venta del lunes, y el
// reporte deja de cuadrar con lo que el dueño sabe que pasó.
//
// horaCierreOperativo ("HH:mm", RD) marca dónde termina el día operativo de
// un restaurante. Todo lo que ocurra ANTES de esa hora cuenta como el día
// anterior. Con el valor por defecto "00:00" el comportamiento es idéntico
// al de antes (día de calendario puro).
//
// República Dominicana: UTC-4 fijo todo el año, sin horario de verano — por
// eso el offset es una constante, no algo que dependa de la fecha.
//
// Toda función de aquí recibe el instante como milisegundos UTC (número),
// nunca un objeto Date "ya en hora local" ni un Timestamp de Firestore — así
// es la misma función sin importar si el caller vive en el navegador
// (Timestamp.toMillis()), en una Cloud Function (Date.now()) o en un script
// de backfill (Timestamp.toMillis() del Admin SDK).
//
// Esta lógica está duplicada (no importada) entre functions/lib/ y
// src/utils/ porque son dos paquetes de Node separados (functions/ tiene su
// propio package.json y node_modules) — no hay forma de compartir un solo
// archivo entre el bundle del cliente (Vite/ESM) y Cloud Functions (CJS)
// sin un paquete compartido, que sería mucho más cambio del que pide esta
// tarea. Si cambias esta lógica, cambia también la copia en el otro lado.
// Verificada con casos concretos — ver functions/lib/fechaOperativa.js.

export const OFFSET_RD_MS = 4 * 60 * 60 * 1000;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

// "HH:mm" → minutos desde medianoche. Entradas ausentes o inválidas caen a 0
// (== "00:00", el comportamiento de antes) en vez de lanzar un error.
export function parsearHoraCierre(horaCierreOperativo) {
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(horaCierreOperativo || '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Instante (ms UTC) → su fecha operativa "YYYY-MM-DD" en hora de RD.
// Si la hora local del instante es ANTERIOR al cierre, la fecha operativa es
// el día calendario anterior; si no, es el mismo día.
export function fechaOperativa(timestampMs, horaCierreOperativo) {
  const minutosCierre = parsearHoraCierre(horaCierreOperativo);
  const localMs = timestampMs - OFFSET_RD_MS;
  const local = new Date(localMs);
  const minutosLocal = local.getUTCHours() * 60 + local.getUTCMinutes();
  const efectivoMs = minutosLocal < minutosCierre ? localMs - MS_POR_DIA : localMs;
  const efectivo = new Date(efectivoMs);
  const y = efectivo.getUTCFullYear();
  const mo = String(efectivo.getUTCMonth() + 1).padStart(2, '0');
  const d = String(efectivo.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// Instante exacto (Date, ms UTC) en que EMPIEZA el día operativo `fechaStr`
// ("YYYY-MM-DD") — es decir, horaCierreOperativo en hora de RD de ese mismo
// día calendario.
export function inicioDiaOperativo(fechaStr, horaCierreOperativo) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const minutosCierre = parsearHoraCierre(horaCierreOperativo);
  const medianocheUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return new Date(medianocheUtcMs + OFFSET_RD_MS + minutosCierre * 60 * 1000);
}

// Rango [inicio, fin) del día operativo `fechaStr` — 24 horas exactas.
export function rangoDiaOperativo(fechaStr, horaCierreOperativo) {
  const inicio = inicioDiaOperativo(fechaStr, horaCierreOperativo);
  return { inicio, fin: new Date(inicio.getTime() + MS_POR_DIA) };
}

// Fecha operativa del instante actual.
export function fechaOperativaHoy(horaCierreOperativo) {
  return fechaOperativa(Date.now(), horaCierreOperativo);
}
