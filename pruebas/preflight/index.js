#!/usr/bin/env node
// Verificación previa a la entrega — un solo comando que confirma que todo
// está sano antes de entregarle MesaDigital a un restaurante real.
//
// Uso:
//   node preflight/index.js <restauranteId>
//   node preflight/index.js <restauranteId> --con-pedido-de-prueba
//   node preflight/index.js <restauranteId> --con-pedido-de-prueba --mesa=2
//   node preflight/index.js <restauranteId> --solo-infraestructura
//   node preflight/index.js <restauranteId> --base-url=http://localhost:4173
//
// (también: npm run preflight -- <restauranteId> [flags], desde pruebas/)
//
// Qué hace y qué NO hace:
// - Todo lo de "Infraestructura" y "Restaurante" es de solo lectura.
// - "Prueba de humo real" ESCRIBE y BORRA un pedido de prueba real — por
//   eso es opcional (--con-pedido-de-prueba). Ver el comentario al inicio
//   de humo.js para cuándo es seguro correrla.
// - Termina con código de salida 1 si algo quedó en rojo (útil para CI o
//   para saber, sin leer con atención, si ya se puede entregar).

import { RESTAURANTE_ID as RESTAURANTE_DE_PRUEBAS, BASE_URL_PROD } from '../config.js';
import { Reporte } from './reporte.js';
import { verificarCloudFunctions, verificarReglasFirestore, verificarReglasStorage, verificarVercel, verificarAppCheck, verificarBackupsPITR, verificarAlertas } from './infraestructura.js';
import { verificarRestaurante } from './restaurante.js';
import { pruebaDeHumo } from './humo.js';

function parsearArgs(argv) {
  const posicionales = argv.filter((a) => !a.startsWith('--'));
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    })
  );
  return { restauranteId: posicionales[0], flags };
}

async function main() {
  const { restauranteId, flags } = parsearArgs(process.argv.slice(2));

  if (!restauranteId) {
    console.log(`
Falta el ID del restaurante.

Uso:
  node preflight/index.js <restauranteId> [--con-pedido-de-prueba] [--mesa=1] [--solo-infraestructura] [--base-url=https://...]

Ejemplo, contra el restaurante de pruebas dedicado:
  node preflight/index.js ${RESTAURANTE_DE_PRUEBAS}

El ID de un restaurante real se copia del Panel Maestro (/maestro), columna "ID:" bajo su nombre.
`);
    process.exit(1);
  }

  const baseUrl = flags['base-url'] || BASE_URL_PROD;
  const mesa = flags.mesa || '1';

  console.log(`\nMesaDigital — verificación previa a la entrega`);
  console.log(`Restaurante: ${restauranteId}`);
  console.log(`Base URL:    ${baseUrl}`);

  const reporte = new Reporte();

  if (!flags['solo-restaurante']) {
    await verificarCloudFunctions(reporte);
    await verificarReglasFirestore(reporte);
    await verificarReglasStorage(reporte);
    await verificarVercel(reporte);
    await verificarAppCheck(reporte);
    await verificarBackupsPITR(reporte);
    await verificarAlertas(reporte);
  }

  if (!flags['solo-infraestructura']) {
    await verificarRestaurante(reporte, restauranteId, { baseUrl });

    if (flags['con-pedido-de-prueba']) {
      await pruebaDeHumo(reporte, restauranteId, { mesa });
    } else {
      reporte.categoria('Prueba de humo real (pedido de prueba)');
      reporte.aviso(
        'Prueba de humo',
        'No se corrió — es opcional y escribe un pedido real (que luego borra).',
        'Corre este mismo comando agregando --con-pedido-de-prueba cuando el restaurante NO esté recibiendo pedidos reales todavía (el caso normal antes de una entrega).'
      );
    }
  }

  const todoBien = reporte.imprimir();
  process.exit(todoBien ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ El preflight no pudo terminar de correr:', e.message);
  process.exit(1);
});
