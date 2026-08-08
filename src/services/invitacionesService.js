import { Timestamp } from 'firebase/firestore';
import * as invitacionesRepo from '../repositories/invitacionesRepository';
import { getCanjearInvitacionFn } from '../repositories/functionsRepository';
import { loginConCustomToken } from './authService';

const DIAS_EXPIRACION = 7;

function generarTokenInvitacion() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function crearInvitacion(restauranteId, rol) {
  const token = generarTokenInvitacion();
  const expiraEn = Timestamp.fromMillis(Date.now() + DIAS_EXPIRACION * 24 * 60 * 60 * 1000);
  await invitacionesRepo.crearInvitacion(token, restauranteId, rol, expiraEn);
  return token;
}

export const revocarInvitacion = (token) => invitacionesRepo.revocarInvitacion(token);

export function subscribeInvitacionesPendientes(restauranteId, cb) {
  return invitacionesRepo.subscribeInvitacionesPendientes(
    restauranteId,
    (invitaciones) => cb([...invitaciones].sort((a, b) => (b.creadoEn?.toMillis() || 0) - (a.creadoEn?.toMillis() || 0))),
    (err) => console.error('subscribeInvitacionesPendientes:', err)
  );
}

// Chequeo en cliente para dar feedback inmediato en /invitacion/:token — la
// validación real (la que importa de verdad) la hace canjearInvitacion en el
// servidor antes de crear la cuenta.
export async function validarInvitacion(token) {
  const snap = await invitacionesRepo.obtenerInvitacion(token);
  if (!snap.exists()) return { valida: false, motivo: 'no-existe' };
  const inv = snap.data();
  if (inv.revocada) return { valida: false, motivo: 'revocada' };
  if (inv.usadaPor) return { valida: false, motivo: 'usada' };
  if (!inv.expiraEn || inv.expiraEn.toMillis() < Date.now()) return { valida: false, motivo: 'vencida' };
  return { valida: true, restauranteId: inv.restauranteId, rol: inv.rol };
}

// canjearInvitacion (Admin SDK) crea la cuenta y otorga el rol atómicamente
// server-side, y devuelve un custom token — así nunca queda una cuenta sin
// rol a medio camino, sin importar en qué paso falle.
export async function canjearInvitacion({ token, email, password }) {
  const { data } = await getCanjearInvitacionFn()({ token, email, password });
  await loginConCustomToken(data.customToken);
  return { restauranteId: data.restauranteId, rol: data.rol };
}
