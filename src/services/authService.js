import * as authRepo from '../repositories/authRepository';

export const login = (email, password) => authRepo.loginEmail(email, password);

export const loginAnonimo = () => authRepo.loginAnonimo();

export const logout = () => authRepo.logout();

export const recuperarPassword = (email) => authRepo.recuperarPassword(email);

export const suscribirEstadoAuth = (cb) => authRepo.suscribirEstadoAuth(cb);

export const getUsuario = () => authRepo.getUsuarioActual();

export const getUid = () => authRepo.getUsuarioActual()?.uid ?? null;

export const esMaestro = () => getUid() === import.meta.env.VITE_MAESTRO_UID;
