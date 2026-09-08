// Acceso a APIs de Google Cloud con las credenciales ADC de `firebase login`
// — el mismo mecanismo que ya usa el resto de pruebas/ (ver config.js y
// appcheck-debug-token.js). No se agrega ninguna dependencia nueva: todo
// esto es firebase-admin (ya en package.json) + fetch nativo de Node.

import { initializeApp, applicationDefault, getApps, getApp } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { PROJECT_ID, ADC_CREDENTIALS_PATH, FIREBASE_CLIENT_CONFIG } from '../config.js';

if (getApps().length === 0) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_CREDENTIALS_PATH;
  initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
    storageBucket: FIREBASE_CLIENT_CONFIG.storageBucket,
  });
}

export const app = getApp();
export const db = getFirestore();
export const auth = getAuth();
export const securityRules = getSecurityRules(app);

export async function tokenAcceso() {
  const { access_token: accessToken } = await app.options.credential.getAccessToken();
  return accessToken;
}

// GET autenticado contra cualquier API REST de Google Cloud (Cloud
// Functions, Firestore Admin, Cloud Monitoring...). Todas usan el mismo
// esquema de auth (Bearer token de la cuenta de `firebase login`) — un solo
// helper evita repetir el manejo de errores en cada verificación.
export async function googleApiGet(url) {
  const token = await tokenAcceso();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const mensaje = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`${mensaje} (${url.split('/').slice(2, 4).join('/')})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
