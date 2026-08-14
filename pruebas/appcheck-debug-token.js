// Registra un token de depuración de App Check para el proyecto, vía la API
// REST de App Check — no requiere abrir la consola de Firebase a mano. Se
// corre UNA vez (o cuando se quiera rotar el token); el valor resultante se
// guarda en pruebas/.env.pruebas (fuera de git) para que el resto de
// pruebas/ lo lea sin tener que volver a generarlo.
//
// Por qué esto es seguro para producción: un token de depuración registrado
// así NO afecta a los usuarios reales — reCAPTCHA Enterprise sigue
// exigiéndose para cualquier llamada que no presente este token exacto.
// Es el mecanismo que Firebase documenta oficialmente para probar App
// Check desde CI/herramientas automatizadas (ver
// https://firebase.google.com/docs/app-check/web/debug-provider).
//
// Requiere las credenciales ADC de firebase-tools (ver config.js) con
// permiso para administrar App Check en el proyecto — el mismo login que
// ya se usa en todo este repo para leer/escribir Firestore como Admin SDK.

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { randomUUID } from 'crypto';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { PROJECT_ID, ADC_CREDENTIALS_PATH, FIREBASE_CLIENT_CONFIG } from './config.js';

process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_CREDENTIALS_PATH;

const ENV_PATH = new URL('./.env.pruebas', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function main() {
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const { access_token: accessToken } = await app.options.credential.getAccessToken();

  const token = randomUUID();
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${FIREBASE_CLIENT_CONFIG.appId}/debugTokens`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `pruebas-ejercito-virtual-${new Date().toISOString().slice(0, 10)}`, token }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('No se pudo registrar el token de depuración:', res.status, JSON.stringify(body));
    process.exit(1);
  }

  const linea = `PRUEBAS_APPCHECK_DEBUG_TOKEN=${token}\n`;
  const previo = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const sinLineaVieja = previo.split('\n').filter((l) => l && !l.startsWith('PRUEBAS_APPCHECK_DEBUG_TOKEN=')).join('\n');
  writeFileSync(ENV_PATH, (sinLineaVieja ? sinLineaVieja + '\n' : '') + linea);

  console.log('Token de depuración registrado:', body.name);
  console.log('Valor:', token);
  console.log('Guardado en pruebas/.env.pruebas (PRUEBAS_APPCHECK_DEBUG_TOKEN).');
}

main().catch((e) => { console.error(e); process.exit(1); });
