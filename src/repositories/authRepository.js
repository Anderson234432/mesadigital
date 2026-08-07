import {
  signInWithEmailAndPassword,
  signInAnonymously,
  signInWithCustomToken,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../firebase';

export const loginEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

// Usado tras canjear una invitación: la Cloud Function canjearInvitacion crea
// la cuenta server-side y devuelve un custom token para iniciar sesión con ella.
export const loginConCustomToken = (token) =>
  signInWithCustomToken(auth, token);

export const loginAnonimo = () => signInAnonymously(auth);

export const logout = () => signOut(auth);

export const recuperarPassword = (email) => sendPasswordResetEmail(auth, email);

export const suscribirEstadoAuth = (cb) => onAuthStateChanged(auth, cb);

export const getUsuarioActual = () => auth.currentUser;
