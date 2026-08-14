// Llama a crearPedido directamente desde Node — sesión anónima real +
// App Check real (vía token de depuración canjeado por un JWT), sin
// navegador. Reutilizado por:
// - Fase 1: escenarios que validan la Cloud Function en sí (lo que un
//   cliente honesto nunca podría construir desde la interfaz: un plato
//   agotado que el acordeón ya filtra, un carrito de 31 items, un token de
//   mesa a mano, etc.) — probar esto por la UI sería simular una interfaz
//   que ya impide el caso, no probar la validación real del servidor.
// - Fase 2: carga — un navegador por cliente no escala; esto sí.
//
// GOTCHA DOCUMENTADO (costó una sesión de depuración encontrarlo): el
// string crudo del token de depuración NO es un JWT válido de App Check.
// El SDK del navegador, al detectar self.FIREBASE_APPCHECK_DEBUG_TOKEN, lo
// CANJEA internamente por un JWT antes de mandarlo — no manda el string
// crudo. Sin ese canje, el backend responde 401 "Unauthenticated" con un
// mensaje genérico que no distingue si falló Auth o App Check (confirmado
// leyendo `firebase functions:log`, que sí lo distingue:
// {"auth":"VALID","app":"INVALID"}). `exchangeDebugToken` (ver abajo) hace
// ese canje explícitamente.

import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FIREBASE_CLIENT_CONFIG, PROJECT_ID, APPCHECK_DEBUG_TOKEN } from '../config.js';

async function exchangeDebugToken(debugToken) {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${FIREBASE_CLIENT_CONFIG.appId}:exchangeDebugToken?key=${FIREBASE_CLIENT_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debug_token: debugToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`exchangeDebugToken falló: ${res.status} ${JSON.stringify(body)}`);
  return body; // { token, ttl }
}

// Cachea el JWT canjeado un rato (la mayoría de las corridas hacen muchas
// llamadas seguidas) — evita un round-trip extra de red por cada pedido
// simulado. Un margen de 5 min bajo el ttl real para no usarlo ya vencido.
let cacheToken = null;
let cacheExpira = 0;
async function tokenAppCheckVigente() {
  if (cacheToken && Date.now() < cacheExpira) return cacheToken;
  const { token, ttl } = await exchangeDebugToken(APPCHECK_DEBUG_TOKEN);
  const ttlMs = (parseInt(ttl, 10) || 3600) * 1000;
  cacheToken = token;
  cacheExpira = Date.now() + ttlMs - 5 * 60 * 1000;
  return token;
}

// Un "cliente directo" = una identidad anónima propia (para que el rate
// limit por UID se aplique de forma realista, uno por cliente simulado) +
// las funciones ya listas para llamar crearPedido.
export async function crearClienteDirecto(nombreUnico) {
  const app = initializeApp(FIREBASE_CLIENT_CONFIG, nombreUnico || `cliente-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        const token = await tokenAppCheckVigente();
        return { token, expireTimeMillis: cacheExpira };
      },
    }),
    isTokenAutoRefreshEnabled: false,
  });
  const auth = getAuth(app);
  const cred = await signInAnonymously(auth);
  const functions = getFunctions(app, 'us-central1');
  const crearPedidoFn = httpsCallable(functions, 'crearPedido');

  return {
    uid: cred.user.uid,
    app,
    async crearPedido({ restauranteId, mesa, items, nota, idempotencyKey, token }) {
      const inicio = Date.now();
      try {
        const result = await crearPedidoFn({
          restauranteId, mesa, items, nota: nota || '',
          clienteUid: cred.user.uid,
          idempotencyKey: idempotencyKey || crypto.randomUUID(),
          token: token || '',
        });
        return { ok: true, data: result.data, ms: Date.now() - inicio };
      } catch (e) {
        return { ok: false, code: e.code || null, message: e.message, ms: Date.now() - inicio };
      }
    },
    async destruir() {
      await deleteApp(app).catch(() => {});
    },
  };
}
