// Configuración central del "ejército de clientes virtuales". Todo lo demás
// en pruebas/ importa de aquí — un solo lugar para saber contra qué
// restaurante corren las pruebas y con qué credenciales.
//
// REGLA ABSOLUTA: RESTAURANTE_ID debe ser SIEMPRE el restaurante de pruebas
// dedicado, nunca uno real. Está marcado con un ID legible a propósito
// (no un ID autogenerado de Firestore) para que sea imposible confundirlo
// con un restaurante de un cliente real con solo mirarlo.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carga pruebas/.env.pruebas directo del archivo — NO basta con que el
// archivo exista, Node no lo mete solo en process.env (esto costó una
// sesión de depuración completa: sin esto, APPCHECK_DEBUG_TOKEN caía
// siempre al placeholder de abajo, sin ningún error visible, y
// exchangeDebugToken fallaba con "App attestation failed" — un mensaje que
// no deja ver que la causa real es un token vacío/inválido).
function leerEnvPruebas() {
  const ruta = join(__dirname, '.env.pruebas');
  if (!existsSync(ruta)) return {};
  return Object.fromEntries(
    readFileSync(ruta, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx), l.slice(idx + 1)];
      })
  );
}
const envPruebas = leerEnvPruebas();

export const PROJECT_ID = 'mesadigital-d9b90';

// ID fijo y legible — ver pruebas/setup.js para cómo se crea. Si esto
// cambia alguna vez, tiene que ser deliberado, nunca accidental.
export const RESTAURANTE_ID = 'mesadigital-pruebas-ejercito-virtual';

export const BASE_URL = process.env.PRUEBAS_BASE_URL || 'http://localhost:4173';
export const BASE_URL_PROD = 'https://mesadigital-pi.vercel.app';

export const MAESTRO_UID = 'xB7aybhKvYhIkuq7TERTuMfUkaH2';

// Credencial ADC de firebase-tools (login de `firebase login`, cacheada
// localmente) — usada por firebase-admin para leer/escribir Firestore
// directamente al preparar/limpiar/verificar. Ver INVENTARIO_MESADIGITAL.md
// y la nota de "Aplication Default Credentials" en la memoria del proyecto
// para el porqué de esta ruta específica.
export const ADC_CREDENTIALS_PATH =
  'C:\\Users\\user\\AppData\\Roaming\\firebase\\andreisa1900_gmail_com_application_default_credentials.json';

// Token de depuración de App Check — registrado una sola vez vía la API
// REST de App Check (projects/{p}/apps/{a}/debugTokens), ver
// pruebas/appcheck-debug-token.js. Con self.FIREBASE_APPCHECK_DEBUG_TOKEN
// puesto a este valor exacto ANTES de que cargue firebase.js, el SDK de
// App Check omite reCAPTCHA Enterprise y presenta este token — el backend
// lo acepta porque está en la lista de tokens de depuración del proyecto.
// Nunca se usa contra la URL de producción real de cara al público; solo
// contra un build local (`vite preview`) servido para las pruebas.
export const APPCHECK_DEBUG_TOKEN = process.env.PRUEBAS_APPCHECK_DEBUG_TOKEN
  || envPruebas.PRUEBAS_APPCHECK_DEBUG_TOKEN
  || '__FALTA_REGISTRAR__';

// Firebase config del cliente (mismos valores que .env — públicos por
// diseño, ver src/firebase.js).
export const FIREBASE_CLIENT_CONFIG = {
  apiKey: 'AIzaSyCZ8qGDsZNrijAkQVWvXtGRWelFc8FPkyM',
  authDomain: 'mesadigital-d9b90.firebaseapp.com',
  projectId: 'mesadigital-d9b90',
  storageBucket: 'mesadigital-d9b90.firebasestorage.app',
  messagingSenderId: '66825226425',
  appId: '1:66825226425:web:5299f7098c2f4ffc58f368',
};
