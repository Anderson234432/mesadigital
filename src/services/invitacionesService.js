import { Timestamp } from 'firebase/firestore';
import * as invitacionesRepo from '../repositories/invitacionesRepository';
import { getCanjearInvitacionFn } from '../repositories/functionsRepository';
import { registrarEmail } from './authService';

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

// Dos pasos separados (no uno combinado) a propósito: el componente necesita
// distinguir "no se pudo crear la cuenta" (la invitación sigue intacta, se
// puede reintentar) de "la cuenta se creó pero no se pudo asignar el rol"
// (son mensajes y siguientes pasos distintos para quien se está registrando).
export const crearCuentaInvitado = (email, password) => registrarEmail(email, password);

export async function otorgarRolInvitacion(token) {
  const { data } = await getCanjearInvitacionFn()({ token });
  return { restauranteId: data.restauranteId, rol: data.rol };
}
