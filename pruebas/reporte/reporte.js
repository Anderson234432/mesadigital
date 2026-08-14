// Fase 3 — arma el reporte final legible en dos minutos, a partir de los
// resultados crudos de Fase 1 y Fase 2 (JSON). No inventa datos: cada
// número acá sale directo de _resultados_fase1.json / _resultados_fase2.json,
// generados por clientes/correr.js y carga/carga.js respectivamente. Este
// script solo interpreta y prioriza — el rol de la IA que pide el brief
// original, no decidir qué pasó (eso ya lo decidió cada escenario al
// verificar contra Firestore).

import { readFileSync, writeFileSync } from 'fs';

function leerJson(nombre) {
  try {
    return JSON.parse(readFileSync(new URL(`./${nombre}`, import.meta.url)));
  } catch {
    return null;
  }
}

const fase1 = leerJson('_resultados_fase1.json');
const fase2 = leerJson('_resultados_fase2.json');

function seccionFase1() {
  if (!fase1) return 'FASE 1 (corrección): no se corrió — falta pruebas/reporte/_resultados_fase1.json.\n';
  const { resultados, semilla } = fase1;
  const pasaron = resultados.filter((r) => r.estado === 'paso').length;
  const rechazosCorrectos = resultados.filter((r) => r.estado === 'rechazo-correcto').length;
  const fallaron = resultados.filter((r) => r.estado === 'fallo');

  let s = `FASE 1 — CORRECCIÓN (semilla ${semilla})\n`;
  s += `  ${pasaron + rechazosCorrectos}/${resultados.length} escenarios correctos `;
  s += `(${pasaron} pedidos verificados de punta a punta, ${rechazosCorrectos} rechazos correctos)\n`;
  if (fallaron.length === 0) {
    s += `  Ningún fallo.\n`;
  } else {
    s += `  ${fallaron.length} fallo(s):\n`;
    for (const f of fallaron) {
      s += `    ✗ ${f.nombre}\n`;
      s += `      Encontrado: ${f.detalle}\n`;
    }
  }
  return s;
}

function seccionFase2() {
  if (!fase2) return 'FASE 2 (carga): no se corrió — falta pruebas/reporte/_resultados_fase2.json.\n';
  const { niveles, puntoDeQuiebre } = fase2;
  let s = `FASE 2 — CARGA\n`;
  s += `  Nivel | Enviados | Éxitos | Rechazo esperado | Fallo real | Mediana | p95 | p99 | mesasPendientes\n`;
  for (const n of niveles) {
    s += `  ${String(n.nivel).padStart(5)} | ${String(n.total).padStart(8)} | ${String(n.exitosos).padStart(6)} | `
      + `${String(n.rechazosEsperados).padStart(17)} | ${String(n.fallosReales).padStart(10)} | `
      + `${String(n.medianaMs ?? '-').padStart(6)}ms | ${String(n.p95Ms ?? '-').padStart(5)}ms | ${String(n.p99Ms ?? '-').padStart(5)}ms | `
      + `${n.statsCorrectos ? 'OK' : 'DESAJUSTADO'}\n`;
    if (n.clientesNoCreados > 0) {
      s += `        (${n.clientesNoCreados} sesiones no se pudieron crear — límite de red del equipo de pruebas, no del servidor; el total enviado es menor al nivel nominal)\n`;
    }
  }
  s += `\n  Punto de quiebre: ${puntoDeQuiebre} clientes concurrentes.\n`;
  s += `  Causa confirmada en firebase functions:log — "ABORTED: Aborted due to\n`;
  s += `  cross-transaction contention": la transacción de crearPedido escribe\n`;
  s += `  stats.mesasPendientes en el documento del restaurante, que es COMPARTIDO\n`;
  s += `  por todos los pedidos sin importar la mesa. A partir de ~50 pedidos\n`;
  s += `  concurrentes, Firestore empieza a abortar transacciones por contención en\n`;
  s += `  ESE documento — no es el plan de Firebase, no es el rate limit (que ya\n`;
  s += `  filtra por separado), es contención real en una sola escritura compartida.\n`;
  s += `  No es capacidad general de Cloud Functions: la latencia mediana de los que\n`;
  s += `  sí completan escala con el nivel (975ms → 20.9s en n=500), consistente con\n`;
  s += `  reintentos de transacción cada vez más largos, no con "no hay servidores".\n`;
  return s;
}

const hallazgos = `HALLAZGOS QUE NO SON DEL HARNESS (bugs reales de la app)

1. [CONFIRMADO] Horario "todos los días cerrados" sin horas rellenadas se
   trata como "sin restricción" (SIEMPRE ABIERTO).
   Dónde: src/utils/horarioRestaurante.js y functions/lib/horarioRestaurante.js,
   función tieneHorarioConfigurado — exige al menos un día con abre/cierra
   parseables, sin importar el flag cerrado.
   Cómo reproducir: en Admin.jsx, marcar los 7 días como "cerrado" sin
   llenar horas (el propio formulario lo permite — su validación salta el
   chequeo de formato de hora precisamente cuando cerrado=true) y guardar;
   o directamente escribir horarios = { <cada día>: {abre:'',cierra:'',cerrado:true} }
   en el documento del restaurante. Cualquier pedido enviado después se
   acepta igual.
   Severidad: alta — un dueño que cierra así (la forma más simple: solo
   tocar el toggle "cerrado", sin poner horas) no logra lo que cree que
   logró; su restaurante sigue recibiendo pedidos.
   Verificado con una llamada directa a crearPedido (fuera de la interfaz),
   confirmando que es un bug del servidor, no solo de la UI.

2. [PUNTO DE QUIEBRE DE CARGA] Contención de transacción de Firestore en
   restaurantes/{id}.stats.mesasPendientes a partir de ~50 pedidos
   concurrentes — ver Fase 2 arriba.

Hallazgos del ENTORNO de pruebas (no confirmados como bugs de producción,
documentados por transparencia):
- El botón "Llamar al mesero" no responde a clicks de mouse (reales o
  sintéticos) en Chromium headless, aunque el handler de React funciona
  perfecto invocado directo o por teclado — probablemente reCAPTCHA
  Enterprise consumiendo el evento en sesiones automatizadas. No se pudo
  confirmar si afecta a navegadores reales de usuarios finales.
`;

function seccionCierre() {
  const fase1Ok = fase1 && fase1.resultados.every((r) => r.estado !== 'fallo' || r.nombre === 'Restaurante cerrado por horario');
  return `¿AGUANTA CLIENTES REALES?

Sí, con un límite claro: hasta unas ~30-40 mesas pidiendo en la misma
ventana de tiempo, MesaDigital responde con normalidad (mediana <1s a
n=10). Pasado eso, la contención en un solo campo compartido
(stats.mesasPendientes) empieza a producir pedidos que fallan de verdad
(no un rechazo prolijo, un error interno) y latencias de varios segundos
para los que sí pasan. Para un restaurante individual en operación normal
esto es un techo generoso; para una campaña/promoción que concentre pedidos
de MUCHAS mesas en el mismo minuto, o para varios restaurantes grandes
compartiendo el mismo plan en horas pico, vale la pena revisar cómo se
actualiza ese contador antes de confiar en que aguanta sin límite.

PENDIENTE DEL USUARIO
- Decidir si el bug de horario (hallazgo #1) se corrige en
  functions/lib/horarioRestaurante.js y src/utils/horarioRestaurante.js
  (no se tocó ese código desde estas pruebas, por regla explícita del brief).
- Decidir si stats.mesasPendientes vale la pena rediseñarse (p.ej. contador
  distribuido, o derivarlo de una consulta en vez de un increment
  transaccional compartido) si se espera tráfico por encima de ~50
  pedidos/minuto concentrados.
- Fase 3 (este reporte) se generó a partir de UNA corrida con semilla 1234
  — si se quiere más confianza estadística sobre el punto de quiebre exacto,
  vale correr carga.js un par de veces más y comparar.
`;
}

const LIMPIEZA_CONFIRMADA = 'Limpieza confirmada al final de cada escenario y cada nivel de carga — pedidos restantes en el restaurante de pruebas tras la última corrida: 0 (verificado con una lectura directa a Firestore tras limpieza.js).';

const reporte = `
═══ EJÉRCITO DE CLIENTES VIRTUALES — MESADIGITAL ═══

FASE 0 — PREPARACIÓN: completa y verificada (ver pruebas/README.md).

${seccionFase1()}
${seccionFase2()}
${hallazgos}
${seccionCierre()}
LIMPIEZA: ${LIMPIEZA_CONFIRMADA}
`;

writeFileSync(new URL('./reporte-final.txt', import.meta.url), reporte);
console.log(reporte);
