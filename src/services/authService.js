import * as authRepo from '../repositories/authRepository';
import * as configRepo from '../repositories/configRepository';

export const login = (email, password) => authRepo.loginEmail(email, password);

export const loginAnonimo = () => authRepo.loginAnonimo();

export const loginConCustomToken = (token) => authRepo.loginConCustomToken(token);

export const enviarVerificacionEmail = () => authRepo.enviarVerificacionEmail();

export const emailVerificado = () => authRepo.emailVerificado();

export const logout = () => authRepo.logout();

export const recuperarPassword = (email) => authRepo.recuperarPassword(email);

export const suscribirEstadoAuth = (cb) => authRepo.suscribirEstadoAuth(cb);

export const getUid = () => authRepo.getUsuarioActual()?.uid ?? null;

// UID hardcodeado de respaldo (coherente con el mismo UID en firestore.rules).
export const esMaestroOriginal = () => getUid() === import.meta.env.VITE_MAESTRO_UID;

// Maestro = el UID original, o cualquiera en config/maestros.uids — igual que
// esMaestro() en firestore.rules. Es async porque requiere una lectura a
// Firestore; solo se usa al entrar a /maestro, no en el arranque general de
// la app (no debe frenar el menú del cliente ni los paneles de admin/cocina).
export async function esMaestroAsync(uid) {
  if (!uid) return false;
  if (uid === import.meta.env.VITE_MAESTRO_UID) return true;
  const snap = await configRepo.obtenerConfigMaestros();
  return snap.exists() && (snap.data().uids || []).includes(uid);
}
