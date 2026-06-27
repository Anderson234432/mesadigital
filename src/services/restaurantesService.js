import * as repo from '../repositories/restaurantesRepository';
import { getUid } from './authService';

const MAESTRO_UID = import.meta.env.VITE_MAESTRO_UID;

export async function verificarAccesoAdmin(restauranteId) {
  const uid = getUid();
  if (!uid) return { acceso: false };
  const snap = await repo.obtenerRestaurante(restauranteId);
  if (!snap.exists()) return { acceso: false };
  const data = snap.data();
  const acceso = uid === MAESTRO_UID || (data.adminUids || []).includes(uid);
  return { acceso, nombre: data.nombre || '', tiempos: data.tiempos || {}, numMesas: data.numMesas || 0 };
}

export async function verificarAccesoCocina(restauranteId) {
  const uid = getUid();
  if (!uid) return false;
  const snap = await repo.obtenerRestaurante(restauranteId);
  if (!snap.exists()) return false;
  const data = snap.data();
  return (
    uid === MAESTRO_UID ||
    (data.adminUids || []).includes(uid) ||
    (data.cocinaUids || []).includes(uid)
  );
}

export function subscribeRestaurante(restauranteId, cb) {
  return repo.subscribeRestaurante(
    restauranteId,
    (snap) => { if (snap.exists()) cb(snap.data()); },
    (err) => console.error('subscribeRestaurante:', err)
  );
}

export function subscribeRestaurantes(cb) {
  return repo.subscribeRestaurantes(
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error('subscribeRestaurantes:', err)
  );
}

export const crearRestaurante = (nombre) =>
  repo.crearRestaurante({ nombre, adminUids: [], cocinaUids: [] });

export const actualizarNombre = (restauranteId, nombre) =>
  repo.actualizarRestaurante(restauranteId, { nombre });

export const eliminarRestaurante = (restauranteId) =>
  repo.eliminarRestaurante(restauranteId);

export const guardarTiempos = (restauranteId, tiempos) =>
  repo.actualizarRestaurante(restauranteId, { tiempos });

export const guardarNumMesas = (restauranteId, numMesas) =>
  repo.actualizarRestaurante(restauranteId, { numMesas });

export const agregarUid = (restauranteId, campo, uid) =>
  repo.agregarUidRol(restauranteId, campo, uid.trim());

export const quitarUid = (restauranteId, campo, uid) =>
  repo.quitarUidRol(restauranteId, campo, uid);
