import {
  collection, doc, getDoc, setDoc, updateDoc, query, where, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

export const obtenerInvitacion = (token) =>
  getDoc(doc(db, 'invitaciones', token));

export const crearInvitacion = (token, restauranteId, rol, expiraEn) =>
  setDoc(doc(db, 'invitaciones', token), {
    restauranteId,
    rol,
    creadoEn: Timestamp.now(),
    expiraEn,
    usadaPor: null,
    usadaEn: null,
    revocada: false,
  });

export const revocarInvitacion = (token) =>
  updateDoc(doc(db, 'invitaciones', token), { revocada: true });

// Sin orderBy a propósito: mezclar varias igualdades con orden por un campo
// distinto puede exigir un índice compuesto. La lista de invitaciones
// pendientes de un restaurante nunca es grande — se ordena en el servicio.
export const subscribeInvitacionesPendientes = (restauranteId, onChange, onError) =>
  onSnapshot(
    query(
      collection(db, 'invitaciones'),
      where('restauranteId', '==', restauranteId),
      where('usadaPor', '==', null),
      where('revocada', '==', false)
    ),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
