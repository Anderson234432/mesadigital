import {
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../firebase';

export const loginEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

export const loginAnonimo = () => signInAnonymously(auth);

export const logout = () => signOut(auth);

export const recuperarPassword = (email) => sendPasswordResetEmail(auth, email);

export const suscribirEstadoAuth = (cb) => onAuthStateChanged(auth, cb);

export const getUsuarioActual = () => auth.currentUser;
