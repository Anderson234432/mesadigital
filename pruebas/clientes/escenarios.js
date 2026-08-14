// Generación de datos variados con semilla — misma semilla, misma corrida
// exacta (para poder reproducir un fallo). No decide QUÉ escenarios corren
// (eso es código fijo en correr.js), solo genera los DATOS dentro de cada
// uno: cantidades, notas con caracteres raros, qué platos concretos usar.

// mulberry32 — PRNG determinista y minúsculo, de dominio público. No hace
// falta una dependencia externa para esto.
export function crearRng(semilla) {
  let a = semilla >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function elegir(rng, lista) {
  return lista[Math.floor(rng() * lista.length)];
}

export function entero(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Notas con caracteres que a un humano armando casos de prueba a mano no
// se le ocurrirían fácil: emojis, comillas, saltos de línea, acentos,
// símbolos que podrían romper un template mal escapado, texto largo cerca
// del límite de 500 caracteres.
const NOTAS_BORDE = [
  'Sin cebolla, por favor 🙏 y bien picante 🌶️🌶️🌶️',
  `Para "Juan" — alergia a los mariscos, IMPORTANTE`,
  'Extra salsa\ny que venga todo junto, no en tandas separadas',
  'Sin gluten — celíaco confirmado. Verificar con cocina antes de preparar.',
  'áéíóú ñ ¿cómo va el tiempo de espera hoy?',
  '   ',
  '',
  'x'.repeat(495) + ' fin', // cerca del límite de 500, no lo pasa
  '<script>alert(1)</script>',
  "It's for the table by the window, thanks!",
];

export function notaAleatoria(rng) {
  return elegir(rng, NOTAS_BORDE);
}

// Arma un plan de pedido (qué platos, cuántas unidades de cada uno) a
// partir del menú real del restaurante de pruebas — nunca inventa un plato
// que no exista.
export function planDePedido(rng, platosDisponibles, { minPlatos = 1, maxPlatos = 3, minCantidad = 1, maxCantidad = 3 } = {}) {
  const cantidadDePlatos = entero(rng, minPlatos, Math.min(maxPlatos, platosDisponibles.length));
  const barajados = [...platosDisponibles].sort(() => rng() - 0.5);
  return barajados.slice(0, cantidadDePlatos).map((plato) => ({
    plato,
    cantidad: entero(rng, minCantidad, maxCantidad),
  }));
}
