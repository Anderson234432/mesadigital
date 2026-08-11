// Validación y normalización del destino de cada botón de la portada — ver
// Admin.jsx (handleGuardarBotones). Cada botón lleva su propio destino
// (campo `destino`); ya no existe una sección de Contacto centralizada.
// Portada.jsx (resolverBoton) resuelve el link directamente desde
// `boton.destino`, salvo 'carta' que siempre va a la ruta de la carta.

export function empiezaConHttp(valor) {
  return /^https?:\/\//i.test((valor || '').trim());
}

// Un número dominicano (809/829/849) son 10 dígitos; wa.me exige el código
// de país (1) delante. Si el dueño escribe los 10 dígitos sin el 1 —el caso
// más común— se lo agregamos en vez de pedirle que lo corrija a mano.
export function normalizarWhatsapp(valor) {
  const digitos = (valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.length === 10 ? `1${digitos}` : digitos;
}

export function normalizarInstagram(valor) {
  const v = (valor || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v.replace(/^@/, '')}`;
}

export function normalizarTelefono(valor) {
  return (valor || '').replace(/\D/g, '');
}

// El destino solo es obligatorio para un botón ACTIVO — uno apagado puede
// quedarse a medio llenar sin bloquear el guardado de los demás. 'carta'
// nunca necesita destino (siempre va a la ruta de la carta).
export function destinoBotonValido(tipo, destino) {
  const v = (destino || '').trim();
  switch (tipo) {
    case 'carta':
      return true;
    case 'mapa':
    case 'enlace':
      return empiezaConHttp(v);
    case 'whatsapp':
      return normalizarWhatsapp(v).length > 0;
    case 'telefono':
      return normalizarTelefono(v).length > 0;
    case 'instagram':
      return v.length > 0;
    default:
      return true;
  }
}

// Normaliza el destino según el tipo, al guardar.
export function normalizarDestinoBoton(tipo, destino) {
  switch (tipo) {
    case 'whatsapp':
      return normalizarWhatsapp(destino);
    case 'instagram':
      return normalizarInstagram(destino);
    case 'telefono':
      return normalizarTelefono(destino);
    default:
      return (destino || '').trim();
  }
}

const CAMPO_CONTACTO_POR_TIPO = { mapa: 'googleMapsUrl', whatsapp: 'whatsapp', instagram: 'instagram', telefono: 'telefono' };

// Migración desde el sistema anterior (donde los botones resolvían su
// destino EN VIVO desde `contacto`, en vez de tener uno propio): si un botón
// tiene `destino` vacío pero existe el dato equivalente en `contacto`, lo
// copia. Nunca toca un botón que ya tiene su propio destino.
export function migrarDestinosDesdeContacto(botones, contacto) {
  let cambio = false;
  const resultado = botones.map((b) => {
    const campo = CAMPO_CONTACTO_POR_TIPO[b.tipo];
    if (campo && !b.destino && contacto?.[campo]) {
      cambio = true;
      return { ...b, destino: contacto[campo] };
    }
    return b;
  });
  return { botones: resultado, cambio };
}
