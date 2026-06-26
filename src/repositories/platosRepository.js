import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

export const subscribePlatos = (restauranteId, onChange, onError) =>
  onSnapshot(
    collection(db, 'restaurantes', restauranteId, 'platos'),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export const crearPlato = (restauranteId, datos) =>
  addDoc(collection(db, 'restaurantes', restauranteId, 'platos'), datos);

export const actualizarPlato = (restauranteId, platoId, datos) =>
  updateDoc(doc(db, 'restaurantes', restauranteId, 'platos', platoId), datos);

export const eliminarPlato = (restauranteId, platoId) =>
  deleteDoc(doc(db, 'restaurantes', restauranteId, 'platos', platoId));
