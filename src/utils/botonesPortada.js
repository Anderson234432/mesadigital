// Botones de la portada derivados automáticamente de Contacto y de si el
// restaurante ya tiene platos — ver Admin.jsx (handleGuardarContacto y el
// efecto de arranque del panel). Portada.jsx (resolverBoton) ya resuelve el
// destino de estos tipos EN VIVO desde `contacto` o la ruta de la carta —
// estas funciones solo deciden si el botón debe existir y estar activo,
// nunca calculan su URL.

function nuevoBotonId() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// tipo → etiquetas por defecto y de qué depende que "deba" estar activo.
const REGLAS = [
  { tipo: 'mapa', etiqueta: 'Cómo llegar', etiquetaEn: 'Directions', activoPor: (c) => !!c.googleMapsUrl },
  { tipo: 'whatsapp', etiqueta: 'WhatsApp', etiquetaEn: 'WhatsApp', activoPor: (c) => !!c.whatsapp },
  { tipo: 'instagram', etiqueta: 'Instagram', etiquetaEn: 'Instagram', activoPor: (c) => !!c.instagram },
  { tipo: 'telefono', etiqueta: 'Llamar', etiquetaEn: 'Call', activoPor: (c) => !!c.telefono },
  { tipo: 'carta', etiqueta: 'Menú', etiquetaEn: 'Menu', activoPor: (_c, tienePlatos) => !!tienePlatos },
];

// Solo agrega los botones que faltan — nunca toca uno que ya existe (ni su
// etiqueta, ni su orden, ni si está activo o no). El dueño ya decidió sobre
// los que ya tiene.
export function agregarBotonesFaltantes(botones, contacto, tienePlatos) {
  let resultado = botones;
  let cambio = false;
  for (const regla of REGLAS) {
    const yaExiste = resultado.some((b) => b.tipo === regla.tipo);
    if (!yaExiste && regla.activoPor(contacto, tienePlatos)) {
      resultado = [...resultado, {
        id: nuevoBotonId(), tipo: regla.tipo, etiqueta: regla.etiqueta, etiquetaEn: regla.etiquetaEn,
        destino: '', activo: true, orden: resultado.length,
      }];
      cambio = true;
    }
  }
  return { botones: resultado, cambio };
}

// Apaga (nunca borra) un botón derivado de Contacto cuyo dato de origen
// quedó vacío — así conserva su etiqueta personalizada si el dueño vuelve a
// llenar el dato. No aplica a 'carta' (depende de platos, no de contacto).
export function desactivarBotonesSinDato(botones, contacto) {
  let cambio = false;
  const resultado = botones.map((b) => {
    const regla = REGLAS.find((r) => r.tipo === b.tipo && r.tipo !== 'carta');
    if (regla && !regla.activoPor(contacto) && b.activo) {
      cambio = true;
      return { ...b, activo: false };
    }
    return b;
  });
  return { botones: resultado, cambio };
}

// Texto para explicarle al dueño de dónde sale el destino de un botón
// automático — se muestra junto a cada fila en Admin.jsx. Los tipos que no
// están aquí (por ahora solo 'enlace') no tienen origen automático.
export function origenBoton(tipo, contacto, tienePlatos) {
  switch (tipo) {
    case 'mapa':
      return contacto.googleMapsUrl
        ? 'Usa tu enlace de Google Maps'
        : 'Falta tu enlace de Google Maps — llénalo arriba para que este botón funcione.';
    case 'whatsapp':
      return contacto.whatsapp
        ? `Usa tu WhatsApp: ${contacto.whatsapp}`
        : 'Falta tu número de WhatsApp — llénalo arriba para que este botón funcione.';
    case 'instagram':
      return contacto.instagram
        ? `Usa tu Instagram: ${contacto.instagram}`
        : 'Falta tu Instagram — llénalo arriba para que este botón funcione.';
    case 'telefono':
      return contacto.telefono
        ? `Usa tu teléfono: ${contacto.telefono}`
        : 'Falta tu teléfono — llénalo arriba para que este botón funcione.';
    case 'carta':
      return tienePlatos
        ? 'Lleva a tu carta pública'
        : 'Necesitas al menos un plato agregado para que este botón funcione.';
    default:
      return null;
  }
}
