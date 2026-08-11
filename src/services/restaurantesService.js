import * as repo from '../repositories/restaurantesRepository';
import { getUid } from './authService';

const MAESTRO_UID = import.meta.env.VITE_MAESTRO_UID;

const IMPUESTOS_DEFAULT = {
  itbisPorcentaje: 18,
  propinaPorcentaje: 10,
  itbisActivo: false,
  propinaActivo: false,
};

export async function verificarAccesoAdmin(restauranteId) {
  const uid = getUid();
  if (!uid) return { acceso: false };
  const snap = await repo.obtenerRestaurante(restauranteId);
  if (!snap.exists()) return { acceso: false };
  const data = snap.data();
  const acceso = uid === MAESTRO_UID || (data.adminUids || []).includes(uid);
  return {
    acceso,
    nombre: data.nombre || '',
    tiempos: data.tiempos || {},
    impuestos: { ...IMPUESTOS_DEFAULT, ...(data.impuestos || {}) },
    horaCierreOperativo: data.horaCierreOperativo || '00:00',
    horaCierreConfiguradaEn: data.horaCierreConfiguradaEn || null,
    marca: data.marca || {},
    horarios: data.horarios || {},
    contacto: data.contacto || {},
    botones: data.botones || [],
  };
}

export async function verificarAccesoCocina(restauranteId) {
  const uid = getUid();
  if (!uid) return { acceso: false, horaCierreOperativo: '00:00' };
  const snap = await repo.obtenerRestaurante(restauranteId);
  if (!snap.exists()) return { acceso: false, horaCierreOperativo: '00:00' };
  const data = snap.data();
  const acceso =
    uid === MAESTRO_UID ||
    (data.adminUids || []).includes(uid) ||
    (data.cocinaUids || []).includes(uid);
  return { acceso, horaCierreOperativo: data.horaCierreOperativo || '00:00' };
}

// Lectura puntual y pública (sin sesión) — usada por /invitacion/:token para
// mostrar el nombre del restaurante antes de que la persona se registre.
export async function obtenerNombreRestaurante(restauranteId) {
  const snap = await repo.obtenerRestaurante(restauranteId);
  return snap.exists() ? (snap.data().nombre || '') : null;
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

export const guardarImpuestos = (restauranteId, impuestos) =>
  repo.actualizarRestaurante(restauranteId, { impuestos });

export const guardarMarca = (restauranteId, marca) =>
  repo.actualizarRestaurante(restauranteId, { marca });

// horaCierreOperativo va derivado de `horarios` (ver Admin.jsx,
// handleGuardarHorarios) — un solo write atómico, nunca dos campos
// relacionados guardados por separado.
export const guardarHorarios = (restauranteId, horarios, horaCierreOperativo, marcarCambioDeCierre) =>
  repo.guardarHorarios(restauranteId, horarios, horaCierreOperativo, marcarCambioDeCierre);

export const guardarContacto = (restauranteId, contacto) =>
  repo.actualizarRestaurante(restauranteId, { contacto });

export const guardarBotones = (restauranteId, botones) =>
  repo.actualizarRestaurante(restauranteId, { botones });

export const guardarNumMesas = (restauranteId, numMesas) =>
  repo.actualizarRestaurante(restauranteId, { numMesas });

export const guardarMesaTokens = (restauranteId, mesaTokens) =>
  repo.guardarMesaTokensPrivado(restauranteId, mesaTokens);

export function subscribeMesaTokens(restauranteId, cb) {
  return repo.subscribeMesaTokensPrivado(
    restauranteId,
    cb,
    (err) => console.error('subscribeMesaTokens:', err)
  );
}

export const agregarUid = (restauranteId, campo, uid) =>
  repo.agregarUidRol(restauranteId, campo, uid.trim());

export const quitarUid = (restauranteId, campo, uid) =>
  repo.quitarUidRol(restauranteId, campo, uid);
