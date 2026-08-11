// Validación y normalización de los campos de Contacto — ver Admin.jsx
// (handleGuardarContacto). Portada.jsx (resolverBoton) ya limpia whatsapp a
// solo dígitos y normaliza instagram a URL al RESOLVER el botón; aquí se
// hace lo mismo pero al GUARDAR, para que el dato quede limpio en Firestore
// y el dueño vea en el campo lo que realmente se está usando.

export const AYUDA_GOOGLE_MAPS_INVALIDO =
  'Pega el enlace completo. En Google Maps: busca tu restaurante → Compartir → Copiar vínculo.';

export function googleMapsUrlValida(valor) {
  const v = (valor || '').trim();
  return v === '' || /^https?:\/\//i.test(v);
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
