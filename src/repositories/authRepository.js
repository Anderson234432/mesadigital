import {
  signInWithEmailAndPassword,
  signInAnonymously,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../firebase';

export const loginEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

// Usado al canjear una invitación: crea la cuenta y deja al usuario
// autenticado en el cliente (sin pasar por Admin SDK ni custom tokens).
export const registrarEmail = (email, password) =>
  createUserWithEmailAndPassword(auth, email, password);

export const enviarVerificacionEmail = () => sendEmailVerification(auth.currentUser);

export const loginAnonimo = () => signInAnonymously(auth);

export const logout = () => signOut(auth);

export const recuperarPassword = (email) => sendPasswordResetEmail(auth, email);

export const suscribirEstadoAuth = (cb) => onAuthStateChanged(auth, cb);

export const getUsuarioActual = () => auth.currentUser;

export const emailVerificado = () => auth.currentUser?.emailVerified ?? true;
