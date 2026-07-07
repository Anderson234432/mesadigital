import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// App Check: solo se activa si VITE_RECAPTCHA_SITE_KEY está configurada.
// Sin esta guarda, initializeAppCheck con site key undefined rompe la app
// para todos los usuarios (este módulo se importa en cada carga de página).
// Hasta que la site key exista en Vercel, la app sigue funcionando igual
// que antes — App Check solo se activa cuando el env var está presente.
if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  if (import.meta.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

function buildCache() {
  try {
    return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch {
    // Safari modo privado y entornos sin IndexedDB
    return memoryLocalCache();
  }
}

export const db = initializeFirestore(app, { localCache: buildCache() });
export const auth = getAuth(app);
export const storage = getStorage(app);