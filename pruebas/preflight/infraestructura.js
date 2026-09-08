// Verificaciones que no dependen de ningún restaurante en particular — la
// salud de la infraestructura compartida por todos. Se corren una sola vez
// por ejecución del preflight, sin importar cuántos restaurantes se estén
// por entregar.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp as initClientApp, getApps as getClientApps, deleteApp } from 'firebase/app';
import { getAuth as getClientAuth, signInAnonymously } from 'firebase/auth';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { PROJECT_ID, BASE_URL_PROD, FIREBASE_CLIENT_CONFIG, APPCHECK_DEBUG_TOKEN } from '../config.js';
import { googleApiGet, securityRules, auth as adminAuth } from './gcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ_PROYECTO = join(__dirname, '..', '..'); // pruebas/preflight -> raíz del repo

// ── Cloud Functions ──────────────────────────────────────────────────────
// Lista cerrada a propósito: si alguien agrega una función nueva a
// functions/index.js y se le olvida sumarla aquí, este chequeo la ignora en
// silencio — pero eso es preferible a que el preflight reviente por un
// nombre que no reconoce. El README/INVENTARIO son el lugar para notar la
// función nueva; aquí solo importa que las que YA se conocen sigan vivas.
const FUNCIONES_ESPERADAS = [
  'crearPedido',
  'enviarCodigoInvitacion',
  'canjearInvitacion',
  'limpiarUsuariosAnonimos',
  'limpiarPedidosAntiguos',
  'limpiarInvitacionesAntiguas',
];
const REGION = 'us-central1';

export async function verificarCloudFunctions(reporte) {
  reporte.categoria('Cloud Functions');
  await reporte.ejecutar('Cloud Functions desplegadas y activas', async () => {
    const body = await googleApiGet(
      `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/functions`
    );
    const porNombre = new Map((body.functions || []).map((f) => [f.name.split('/').pop(), f]));

    for (const nombre of FUNCIONES_ESPERADAS) {
      const f = porNombre.get(nombre);
      if (!f) {
        reporte.fallo(
          `Función "${nombre}"`,
          'No está desplegada en el proyecto.',
          `Corre \`firebase deploy --only functions:${nombre}\` desde la raíz del proyecto (necesitas \`functions/\` con sus dependencias instaladas: \`cd functions && npm install\`).`
        );
      } else if (f.state !== 'ACTIVE') {
        reporte.fallo(
          `Función "${nombre}"`,
          `Estado actual: ${f.state} (esperado: ACTIVE).`,
          'Revisa el log de despliegue en la consola de Firebase (Functions → Registros) o corre `firebase functions:log` para ver el error exacto, y vuelve a desplegar.'
        );
      } else {
        reporte.ok(`Función "${nombre}"`, 'Desplegada y activa.');
      }
    }
  });
}

// ── Reglas de seguridad desplegadas vs. repositorio ─────────────────────
// Compara el CONTENIDO de la regla activa en el proyecto contra el archivo
// local — normalizando fin de línea (CRLF/LF) y espacio en blanco al final,
// que no cambian el comportamiento de la regla pero sí romperían una
// comparación literal entre un archivo editado en Windows y lo que devuelve
// la API de Google (que normaliza distinto).
function normalizar(texto) {
  return texto.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

function primeraLineaQueDifiere(local, remoto) {
  const a = local.split('\n');
  const b = remoto.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if ((a[i] || '') !== (b[i] || '')) return i + 1;
  }
  return null;
}

export async function verificarReglasFirestore(reporte) {
  reporte.categoria('Reglas de seguridad desplegadas');
  await reporte.ejecutar('Reglas de Firestore = repositorio', async () => {
    const ruleset = await securityRules.getFirestoreRuleset();
    const remoto = normalizar(ruleset.source[0].content);
    const local = normalizar(readFileSync(join(RAIZ_PROYECTO, 'firestore.rules'), 'utf8'));
    if (remoto === local) {
      reporte.ok('Reglas de Firestore', 'Lo desplegado coincide exactamente con firestore.rules del repositorio.');
    } else {
      const linea = primeraLineaQueDifiere(local, remoto);
      reporte.fallo(
        'Reglas de Firestore',
        `Lo desplegado NO coincide con firestore.rules${linea ? ` (difieren desde la línea ${linea})` : ''}. El proyecto puede estar corriendo reglas más viejas o más nuevas que el código.`,
        'Corre `firebase deploy --only firestore:rules` desde la raíz del proyecto. Si el repositorio es el que está desactualizado (alguien cambió las reglas a mano en la consola), trae ese cambio al código antes de redesplegar.'
      );
    }
  });
}

export async function verificarReglasStorage(reporte) {
  await reporte.ejecutar('Reglas de Storage = repositorio', async () => {
    const ruleset = await securityRules.getStorageRuleset();
    const remoto = normalizar(ruleset.source[0].content);
    const local = normalizar(readFileSync(join(RAIZ_PROYECTO, 'storage.rules'), 'utf8'));
    if (remoto === local) {
      reporte.ok('Reglas de Storage', 'Lo desplegado coincide exactamente con storage.rules del repositorio.');
    } else {
      const linea = primeraLineaQueDifiere(local, remoto);
      reporte.fallo(
        'Reglas de Storage',
        `Lo desplegado NO coincide con storage.rules${linea ? ` (difieren desde la línea ${linea})` : ''}.`,
        'Corre `firebase deploy --only storage` desde la raíz del proyecto.'
      );
    }
  });
}

// ── Vercel ────────────────────────────────────────────────────────────────
export async function verificarVercel(reporte) {
  reporte.categoria('Sitio en Vercel');
  await reporte.ejecutar('El sitio responde y sirve el build actual', async () => {
    const res = await fetch(BASE_URL_PROD);
    if (!res.ok) {
      reporte.fallo(
        'Sitio en Vercel responde',
        `${BASE_URL_PROD} respondió con estado ${res.status}.`,
        'Revisa el estado del último deploy en el dashboard de Vercel (vercel.com) — puede estar caído o el último deploy falló.'
      );
      return;
    }
    const html = await res.text();
    const match = html.match(/src="(\/assets\/[^"]+\.js)"/);
    if (!match) {
      reporte.fallo(
        'Sitio en Vercel responde',
        'El sitio respondió 200 pero el HTML no tiene la forma esperada (no se encontró el script principal). Puede estar sirviendo una página de error o un build corrupto.',
        'Abre https://mesadigital-pi.vercel.app en el navegador y confirma a simple vista qué se ve.'
      );
      return;
    }
    const resAsset = await fetch(`${BASE_URL_PROD}${match[1]}`, { method: 'HEAD' });
    if (!resAsset.ok) {
      reporte.fallo(
        'Sitio en Vercel responde',
        `El HTML referencia ${match[1]} pero ese archivo responde ${resAsset.status} — el sitio está sirviendo un index.html desincronizado de sus propios archivos.`,
        'Vuelve a desplegar desde Vercel (a veces pasa con un caché de CDN colgado): `vercel --prod` o un redeploy manual desde el dashboard.'
      );
      return;
    }
    reporte.ok('Sitio en Vercel responde', `${BASE_URL_PROD} responde 200 y sirve sus propios archivos (${match[1]}).`);

    // Bonus, no bloqueante: si hay un build local (dist/, ignorado por git),
    // avisa si no coincide con lo desplegado — puede ser normal (cambios
    // locales sin desplegar todavía) o una señal de que falta un deploy.
    const distIndex = join(RAIZ_PROYECTO, 'dist', 'index.html');
    if (existsSync(distIndex)) {
      const localHtml = readFileSync(distIndex, 'utf8');
      const matchLocal = localHtml.match(/src="(\/assets\/[^"]+\.js)"/);
      if (matchLocal && matchLocal[1] !== match[1]) {
        reporte.aviso(
          'Build local (dist/) vs. Vercel',
          `Tu \`dist/\` local (${matchLocal[1]}) no es el mismo build que está en Vercel (${match[1]}).`,
          'Si tenías cambios pendientes de desplegar, esto es normal. Si esperabas que ya estuvieran en producción, haz `npm run build` y despliega de nuevo antes de entregar.'
        );
      }
    }
  });
}

// ── App Check ─────────────────────────────────────────────────────────────
// No hay forma de "ver" desde afuera si App Check está activo sin hacer dos
// llamadas reales: una SIN presentar token de App Check (debe rechazarse
// ANTES de llegar a la lógica del negocio) y otra CON un token válido
// (debe llegar a la lógica del negocio). Ver pruebas/clientes/llamadaDirecta.js
// para el mismo patrón de intercambio de token de depuración.
async function exchangeDebugToken(debugToken) {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${FIREBASE_CLIENT_CONFIG.appId}:exchangeDebugToken?key=${FIREBASE_CLIENT_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debug_token: debugToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`No se pudo canjear el token de depuración de App Check: ${body?.error?.message || res.status}`);
  return body.token;
}

async function llamadaDePrueba({ conAppCheck }) {
  const nombreApp = `preflight-appcheck-${conAppCheck ? 'con' : 'sin'}-${Date.now()}`;
  const app = initClientApp(FIREBASE_CLIENT_CONFIG, nombreApp);
  if (conAppCheck) {
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => ({ token: await exchangeDebugToken(APPCHECK_DEBUG_TOKEN), expireTimeMillis: Date.now() + 30 * 60 * 1000 }),
      }),
      isTokenAutoRefreshEnabled: false,
    });
  }
  const clientAuth = getClientAuth(app);
  const cred = await signInAnonymously(clientAuth);
  const functions = getFunctions(app, REGION);
  const crearPedidoFn = httpsCallable(functions, 'crearPedido');
  let resultado;
  try {
    await crearPedidoFn({
      // OJO: nunca uses un id que empiece Y termine en doble guión bajo
      // (ej. "__algo__") — Firestore lo trata como un nombre de recurso
      // RESERVADO y lo rechaza con un error interno sin manejar en
      // crearPedido (no es "not-found", es "internal"), lo que ensucia
      // esta lectura. Descubierto construyendo este mismo script — ver
      // el hallazgo correspondiente en el reporte de esta tarea.
      restauranteId: 'preflight-appcheck-probe-no-existe-000',
      mesa: '1',
      // Un item cualquiera — tiene que pasar la validación de "1 a 30 items"
      // de crearPedido para que, si el request llega hasta ahí, el primer
      // rechazo real sea "restaurante no existe" (not-found) y no
      // "items inválidos" (invalid-argument), que ensuciaría la lectura de
      // este chequeo.
      items: [{ id: 'preflight-probe', cantidad: 1 }],
      nota: '',
      clienteUid: cred.user.uid,
      idempotencyKey: `preflight-${Date.now()}`,
      token: '',
    });
    resultado = { code: null }; // no debería pasar nunca: el restaurante inventado no existe
  } catch (e) {
    resultado = { code: e.code || null };
  }
  return { uid: cred.user.uid, code: resultado.code, app };
}

export async function verificarAppCheck(reporte) {
  reporte.categoria('App Check');
  await reporte.ejecutar('App Check rechaza llamadas sin verificar', async () => {
    const { uid, code, app } = await llamadaDePrueba({ conAppCheck: false });
    await adminAuth.deleteUser(uid).catch(() => {});
    await deleteApp(app).catch(() => {});
    if (code === 'functions/unauthenticated') {
      reporte.ok(
        'App Check activo',
        'Una llamada autenticada (Auth válido) pero SIN token de App Check fue rechazada antes de llegar a la lógica del pedido, como se espera con `enforceAppCheck: true`.'
      );
    } else {
      reporte.fallo(
        'App Check activo',
        `Una llamada sin token de App Check debía ser rechazada y en cambio devolvió código "${code}" — la función parece estar aceptando llamadas sin verificar.`,
        'Revisa que `crearPedido` en functions/index.js siga teniendo `enforceAppCheck: true` y que esté desplegada esa versión (`firebase deploy --only functions:crearPedido`).'
      );
    }
  });

  if (!APPCHECK_DEBUG_TOKEN || APPCHECK_DEBUG_TOKEN === '__FALTA_REGISTRAR__') {
    reporte.aviso(
      'App Check deja pasar a un cliente legítimo',
      'No se pudo probar el camino positivo (falta el token de depuración de App Check).',
      'Corre `node appcheck-debug-token.js` una vez desde pruebas/ y vuelve a correr el preflight.'
    );
    return;
  }

  await reporte.ejecutar('App Check deja pasar a un cliente verificado', async () => {
    const { uid, code, app } = await llamadaDePrueba({ conAppCheck: true });
    await adminAuth.deleteUser(uid).catch(() => {});
    await deleteApp(app).catch(() => {});
    if (code === 'functions/not-found') {
      reporte.ok(
        'App Check no bloquea clientes legítimos',
        'Con un token de App Check válido, la llamada SÍ llegó a la lógica del pedido (rechazada después por "restaurante no existe", que es lo esperado con un ID inventado).'
      );
    } else {
      reporte.fallo(
        'App Check no bloquea clientes legítimos',
        `Con un token de App Check válido se esperaba llegar a la lógica del pedido (código "functions/not-found") y en cambio se obtuvo "${code}".`,
        'Puede ser un problema de configuración de reCAPTCHA Enterprise/App Check en la consola de Firebase, o que el token de depuración haya sido revocado — revisa Firebase Console → App Check.'
      );
    }
  });
}

// ── Backups y Point-in-Time Recovery ─────────────────────────────────────
export async function verificarBackupsPITR(reporte) {
  reporte.categoria('Backups y recuperación');
  await reporte.ejecutar('Point-in-Time Recovery activo', async () => {
    const info = await googleApiGet(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`);
    if (info.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED') {
      reporte.ok('Point-in-Time Recovery', 'Activo — se puede restaurar la base de datos a cualquier minuto de los últimos 7 días.');
    } else {
      reporte.fallo(
        'Point-in-Time Recovery',
        `Estado actual: ${info.pointInTimeRecoveryEnablement}.`,
        'Actívalo en la consola de Firebase → Firestore → Copias de seguridad → Recuperación a un punto en el tiempo. Tiene un costo adicional pequeño pero es la única forma de deshacer un borrado masivo por error.'
      );
    }
    if (info.deleteProtectionState !== 'DELETE_PROTECTION_ENABLED') {
      reporte.aviso(
        'Protección contra borrado de la base de datos',
        'La base de datos de Firestore se podría eliminar por completo con un solo comando/clic.',
        'Actívala en la consola de Firebase → Firestore → Configuración → Protección contra eliminación.'
      );
    }
  });

  await reporte.ejecutar('Backups automáticos programados', async () => {
    const info = await googleApiGet(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/backupSchedules`);
    const programaciones = info.backupSchedules || [];
    if (programaciones.length === 0) {
      reporte.fallo(
        'Backups automáticos',
        'No hay ninguna programación de backup configurada para la base de datos.',
        'Crea una en la consola de Firebase → Firestore → Copias de seguridad → Programar copia de seguridad diaria (recomendado: retención de al menos 14 días).'
      );
      return;
    }
    for (const prog of programaciones) {
      const dias = Math.round(parseInt(prog.retention, 10) / 86400);
      const frecuencia = prog.dailyRecurrence ? 'diaria' : (prog.weeklyRecurrence ? 'semanal' : 'desconocida');
      if (dias < 7) {
        reporte.aviso(
          'Backups automáticos',
          `Programación ${frecuencia} con retención de solo ${dias} día(s).`,
          'Considera subir la retención a al menos 14 días — un problema descubierto tarde (ej. un cliente que se queja una semana después) necesita margen para restaurar.'
        );
      } else {
        reporte.ok('Backups automáticos', `Programación ${frecuencia}, retención de ${dias} días.`);
      }
    }
  });
}

// ── Alertas de monitoreo ──────────────────────────────────────────────────
export async function verificarAlertas(reporte) {
  reporte.categoria('Alertas de monitoreo');
  await reporte.ejecutar('Alertas de disponibilidad y errores activas', async () => {
    const [alertasBody, canalesBody, uptimeBody] = await Promise.all([
      googleApiGet(`https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/alertPolicies`),
      googleApiGet(`https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels`),
      googleApiGet(`https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/uptimeCheckConfigs`),
    ]);
    const alertas = alertasBody.alertPolicies || [];
    const canales = new Map((canalesBody.notificationChannels || []).map((c) => [c.name, c]));
    const uptimeChecks = uptimeBody.uptimeCheckConfigs || [];

    function evaluar(etiqueta, predicado, sugerencia) {
      const encontrada = alertas.find((a) => predicado(a));
      if (!encontrada) {
        reporte.fallo(`Alerta: ${etiqueta}`, 'No se encontró ninguna alerta de este tipo en el proyecto.', sugerencia);
        return;
      }
      if (!encontrada.enabled) {
        reporte.fallo(`Alerta: ${etiqueta}`, `Existe ("${encontrada.displayName}") pero está DESACTIVADA.`, `Actívala en Cloud Monitoring → Alertas → "${encontrada.displayName}".`);
        return;
      }
      const sinCanal = (encontrada.notificationChannels || []).filter((n) => !canales.get(n)?.enabled);
      if ((encontrada.notificationChannels || []).length === 0) {
        reporte.fallo(`Alerta: ${etiqueta}`, `"${encontrada.displayName}" está activa pero no tiene ningún canal de notificación — si se dispara, nadie se entera.`, `Agrégale un canal (tu correo) en Cloud Monitoring → Alertas → "${encontrada.displayName}" → Editar.`);
        return;
      }
      if (sinCanal.length > 0) {
        reporte.aviso(`Alerta: ${etiqueta}`, `"${encontrada.displayName}" tiene un canal de notificación desactivado.`, 'Revisa Cloud Monitoring → Alertas → Canales de notificación.');
        return;
      }
      reporte.ok(`Alerta: ${etiqueta}`, `"${encontrada.displayName}" activa y notificando a ${(encontrada.notificationChannels || []).length} canal(es).`);
    }

    evaluar(
      'sitio caído',
      (a) => a.conditions?.some((c) => c.conditionThreshold?.filter?.includes('uptime_url')),
      'Crea una alerta de uptime check en Cloud Monitoring → Uptime Checks, apuntando a https://mesadigital-pi.vercel.app.'
    );
    evaluar(
      'errores 5xx en crearPedido',
      (a) => a.conditions?.some((c) => c.conditionThreshold?.filter?.includes('crearpedido') && c.conditionThreshold?.filter?.includes('5xx')),
      'Crea una alerta en Cloud Monitoring sobre la métrica de errores 5xx del servicio Cloud Run "crearpedido".'
    );

    if (uptimeChecks.length === 0) {
      reporte.aviso(
        'Uptime check del sitio',
        'La alerta de "sitio caído" depende de un uptime check activo, y no se encontró ninguno configurado.',
        'Revisa Cloud Monitoring → Uptime Checks — si el check fue borrado, la alerta nunca se va a disparar aunque siga "activa".'
      );
    }
  });
}
