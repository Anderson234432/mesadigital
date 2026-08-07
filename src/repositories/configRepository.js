import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// config/maestros — { uids: [...] }, ver esMaestro() en firestore.rules.
export const obtenerConfigMaestros = () =>
  getDoc(doc(db, 'config', 'maestros'));
