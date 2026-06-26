import {
  collection, doc, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, arrayUnion, arrayRemove,
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

export const agregarUidRol = (restauranteId, campo, uid) =>
  updateDoc(doc(db, 'restaurantes', restauranteId), { [campo]: arrayUnion(uid) });

export const quitarUidRol = (restauranteId, campo, uid) =>
  updateDoc(doc(db, 'restaurantes', restauranteId), { [campo]: arrayRemove(uid) });
