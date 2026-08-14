// Crea (o reinicia) el restaurante de pruebas dedicado — nunca toca datos
// reales, todo vive bajo RESTAURANTE_ID (ver config.js), un ID legible y
// fijo, imposible de confundir con un restauranteId real (que siempre son
// IDs autogenerados de Firestore). Idempotente: correr esto de nuevo
// reescribe el mismo restaurante desde cero, no crea uno adicional.
//
// Qué arma:
// - El documento del restaurante: impuestos activos, horarios abiertos casi
//   todo el día (los escenarios que necesitan "cerrado" lo cierran ellos
//   mismos temporalmente, ver verificacion/horarios.js).
// - Un menú variado: 4 categorías (una con subcategorías, con caso mixto
//   "Otros"), precios distintos, algunos platos con foto y otros sin ella,
//   uno marcado agotado a propósito (para el escenario correspondiente).
// - 5 mesas con sus tokens en _privado/mesaTokens, igual que hace
//   PanelMaestro.jsx al definir numMesas.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'crypto';
import { RESTAURANTE_ID, PROJECT_ID, ADC_CREDENTIALS_PATH } from './config.js';

process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_CREDENTIALS_PATH;
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

// Cuenta de staff DEDICADA a las pruebas — para poder abrir /cocina y
// /admin con Playwright y verificar visualmente, sin usar el UID maestro
// (compartido con toda la operación real) ni pedir credenciales de un
// admin real. Vive solo en este restaurante de pruebas: se agrega a
// adminUids/cocinaUids de ESTE restaurante únicamente.
const STAFF_EMAIL = 'pruebas-ejercito-virtual@mesadigital.test';
const STAFF_PASSWORD = randomUUID(); // rota en cada setup.js — nunca queda una contraseña vieja dando vueltas

async function crearOReiniciarCuentaStaff() {
  let user;
  try {
    user = await auth.getUserByEmail(STAFF_EMAIL);
    await auth.updateUser(user.uid, { password: STAFF_PASSWORD });
  } catch {
    user = await auth.createUser({ email: STAFF_EMAIL, password: STAFF_PASSWORD, emailVerified: true });
  }
  return { uid: user.uid, email: STAFF_EMAIL, password: STAFF_PASSWORD };
}

const HORARIO_ABIERTO_TODO_EL_DIA = { abre: '00:00', cierra: '23:59', cerrado: false };
const HORARIOS_ABIERTOS = {
  domingo: HORARIO_ABIERTO_TODO_EL_DIA, lunes: HORARIO_ABIERTO_TODO_EL_DIA,
  martes: HORARIO_ABIERTO_TODO_EL_DIA, miercoles: HORARIO_ABIERTO_TODO_EL_DIA,
  jueves: HORARIO_ABIERTO_TODO_EL_DIA, viernes: HORARIO_ABIERTO_TODO_EL_DIA,
  sabado: HORARIO_ABIERTO_TODO_EL_DIA,
};

// Fotos vía Lorem Picsum (servicio público estable, determinístico por
// seed) — pegadas directo en imagenUrl, mismo patrón que "pegar una URL"
// ya soportado en el form de plato de Admin.jsx. No pasa por Storage.
const foto = (seed) => `https://picsum.photos/seed/${seed}/600/400`;

const PLATOS = [
  { nombre: 'Ensalada César', categoria: 'Entradas', precio: 250, imagenUrl: foto('cesar'), disponible: true, orden: 1, tiempoMin: 10 },
  { nombre: 'Sopa del día', categoria: 'Entradas', precio: 180, imagenUrl: '', disponible: true, orden: 2, tiempoMin: 8 },
  { nombre: 'Mofongo con camarones', categoria: 'Platos Fuertes', precio: 650, imagenUrl: foto('mofongo'), disponible: true, orden: 1, tiempoMin: 25 },
  { nombre: 'Pollo guisado', categoria: 'Platos Fuertes', precio: 450, imagenUrl: '', disponible: true, orden: 2, tiempoMin: 20 },
  // Agotado a propósito — para el escenario "pedir un plato agotado".
  { nombre: 'Chuleta ahumada', categoria: 'Platos Fuertes', precio: 550, imagenUrl: '', disponible: false, orden: 3, tiempoMin: 20 },
  { nombre: 'Cerveza Presidente', categoria: 'Bebidas', subcategoria: 'Cervezas', precio: 150, imagenUrl: '', disponible: true, orden: 1, tiempoMin: 0 },
  { nombre: 'Cerveza Corona', categoria: 'Bebidas', subcategoria: 'Cervezas', precio: 180, imagenUrl: '', disponible: true, orden: 2, tiempoMin: 0 },
  { nombre: 'Mojito', categoria: 'Bebidas', subcategoria: 'Cócteles', precio: 280, imagenUrl: foto('mojito'), disponible: true, orden: 3, tiempoMin: 5 },
  { nombre: 'Piña Colada', categoria: 'Bebidas', subcategoria: 'Cócteles', precio: 300, imagenUrl: foto('colada'), disponible: true, orden: 4, tiempoMin: 5 },
  // Sin subcategoría, dentro de una categoría que sí las usa -> caso "Otros".
  { nombre: 'Agua', categoria: 'Bebidas', precio: 50, imagenUrl: '', disponible: true, orden: 5, tiempoMin: 0 },
  { nombre: 'Tres Leches', categoria: 'Postres', precio: 180, imagenUrl: foto('tresleches'), disponible: true, orden: 1, tiempoMin: 0 },
  { nombre: 'Flan de Coco', categoria: 'Postres', precio: 160, imagenUrl: '', disponible: true, orden: 2, tiempoMin: 0 },
];

const NUM_MESAS = 5;

async function borrarSubcoleccion(ref) {
  const snap = await ref.get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
  return snap.size;
}

async function main() {
  const restRef = db.collection('restaurantes').doc(RESTAURANTE_ID);

  console.log(`Preparando restaurante de pruebas: ${RESTAURANTE_ID}`);

  // Limpia platos/pedidos previos de corridas anteriores antes de rearmar —
  // así `setup` siempre deja un estado conocido, sin importar qué quedó de
  // la última vez.
  const platosBorrados = await borrarSubcoleccion(restRef.collection('platos'));
  const pedidosBorrados = await borrarSubcoleccion(restRef.collection('pedidos'));
  const categoriasBorradas = await borrarSubcoleccion(restRef.collection('categorias'));
  console.log(`Limpieza previa: ${platosBorrados} platos, ${pedidosBorrados} pedidos, ${categoriasBorradas} metadatos de categoría.`);

  const staff = await crearOReiniciarCuentaStaff();
  console.log(`Cuenta de staff de pruebas lista: ${staff.email}`);

  await restRef.set({
    nombre: '⚠️ PRUEBAS — Ejército de clientes virtuales (no es un restaurante real)',
    adminUids: [staff.uid],
    cocinaUids: [staff.uid],
    numMesas: NUM_MESAS,
    horarios: HORARIOS_ABIERTOS,
    horaCierreOperativo: '00:00',
    tiempos: { bebidas: 5 },
    impuestos: {
      itbisActivo: true, itbisPorcentaje: 18,
      propinaActivo: true, propinaPorcentaje: 10,
    },
    marca: {},
    contacto: {},
    botones: [],
    stats: { mesasPendientes: 0 },
  }, { merge: false }); // merge:false a propósito: cada setup.js parte de cero, nunca hereda campos viejos de una corrida anterior

  const platosCreados = [];
  for (const plato of PLATOS) {
    const doc = await restRef.collection('platos').add({
      nombre: plato.nombre, nombreEn: '', precio: plato.precio,
      categoria: plato.categoria, categoriaEn: '',
      subcategoria: plato.subcategoria || '', subcategoriaEn: '',
      descripcion: `${plato.nombre} — plato de prueba, no es un producto real.`,
      imagenUrl: plato.imagenUrl, disponible: plato.disponible,
      tiempoMin: plato.tiempoMin, orden: plato.orden,
    });
    platosCreados.push({ id: doc.id, ...plato });
  }
  console.log(`${platosCreados.length} platos de prueba creados.`);

  // Mesas + tokens — mismo shape que genera PanelMaestro.jsx al definir
  // numMesas (ver firestore.rules: _privado/mesaTokens es la única
  // subcolección con el token real de cada mesa).
  const mesaTokens = {};
  for (let i = 1; i <= NUM_MESAS; i++) mesaTokens[String(i)] = randomUUID();
  await restRef.collection('_privado').doc('mesaTokens').set({ mesaTokens });
  console.log(`${NUM_MESAS} mesas con token creadas.`);

  const resumen = {
    restauranteId: RESTAURANTE_ID,
    creadoEn: new Date().toISOString(),
    platos: platosCreados,
    mesaTokens,
    categorias: [...new Set(platosCreados.map((p) => p.categoria))],
    staff: { email: staff.email, password: staff.password, uid: staff.uid },
  };

  const fs = await import('fs');
  fs.writeFileSync(
    new URL('./_manifiestos/restaurante-prueba.json', import.meta.url),
    JSON.stringify(resumen, null, 2)
  );
  console.log('\nResumen guardado en pruebas/_manifiestos/restaurante-prueba.json');
  console.log(`\nListo. URL de un menú de prueba (mesa 1):`);
  console.log(`  /restaurante/${RESTAURANTE_ID}/menu/1?t=${mesaTokens['1']}`);
}

main().catch((e) => { console.error('Error preparando el restaurante de pruebas:', e); process.exit(1); });
