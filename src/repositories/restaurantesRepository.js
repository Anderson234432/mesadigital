import {
  collection, doc, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, arrayUnion, arrayRemove, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

export const obtenerRestaurante = (restauranteId) =>
  getDoc(doc(db, 'restaurantes', restauranteId));

export const subscribeRestaurante = (restauranteId, onChange, onError) =>
  onSnapshot(doc(db, 'restaurantes', restauranteId), onChange, onError);

export const subscribeRestaurantes = (onChange, onError) =>
  onSnapshot(collection(db, 'restaurantes'), onChange, onError);

export const crearRestaurante = (datos) =>
  addDoc(collection(db, 'restaurantes'), datos);

export const actualizarRestaurante = (restauranteId, datos) =>
  updateDoc(doc(db, 'restaurantes', restauranteId), datos);

export const eliminarRestaurante = (restauranteId) =>
  deleteDoc(doc(db, 'restaurantes', restauranteId));

// horaCierreOperativo ya no se pide aparte — se deriva de `horarios` (ver
// derivarHoraCierreOperativo en src/utils/horarioRestaurante.js) y se guarda
// en el mismo write que los horarios, para que nunca queden desincronizados.
// horaCierreConfiguradaEn solo se toca cuando el valor derivado REALMENTE
// cambia (marcarCambioDeCierre) — así el aviso de discontinuidad de
// Admin.jsx no reinicia su fecha cada vez que se retocan horas que no
// cruzan medianoche.
export const guardarHorarios = (restauranteId, horarios, horaCierreOperativo, marcarCambioDeCierre) => {
  const datos = { horarios, horaCierreOperativo };
  if (marcarCambioDeCierre) datos.horaCierreConfiguradaEn = serverTimestamp();
  return updateDoc(doc(db, 'restaurantes', restauranteId), datos);
};

// contacto y botones se guardan en el mismo write — guardar Contacto puede
// crear/desactivar botones automáticos (ver agregarBotonesFaltantes y
// desactivarBotonesSinDato en src/utils/botonesPortada.js) y no deben quedar
// desincronizados entre sí. Mismo patrón que guardarHorarios.
export const guardarContacto = (restauranteId, contacto, botones) =>
  updateDoc(doc(db, 'restaurantes', restauranteId), { contacto, botones });

export const agregarUidRol = (restauranteId, campo, uid) =>
  updateDoc(doc(db, 'restaurantes', restauranteId), { [campo]: arrayUnion(uid) });

export const quitarUidRol = (restauranteId, campo, uid) =>
  updateDoc(doc(db, 'restaurantes', restauranteId), { [campo]: arrayRemove(uid) });

// mesaTokens vive en _privado/mesaTokens (subcolección sin lectura pública),
// no en el documento raíz — ver comentario en firestore.rules.
export const subscribeMesaTokensPrivado = (restauranteId, onChange, onError) =>
  onSnapshot(
    doc(db, 'restaurantes', restauranteId, '_privado', 'mesaTokens'),
    (snap) => onChange(snap.exists() ? (snap.data().mesaTokens || {}) : {}),
    onError
  );

export const guardarMesaTokensPrivado = (restauranteId, mesaTokens) =>
  setDoc(doc(db, 'restaurantes', restauranteId, '_privado', 'mesaTokens'), { mesaTokens });
