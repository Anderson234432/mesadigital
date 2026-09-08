# Preflight — verificación previa a la entrega

Un solo comando que confirma, antes de entregarle MesaDigital a un
restaurante real, que la infraestructura compartida y ese restaurante en
particular están sanos. Vive en `pruebas/` por la misma razón que el resto
de esta carpeta: no es parte del build ni del despliegue de la app.

## Uso

```bash
cd pruebas
npm install                 # una sola vez

# Verificación completa (infraestructura + restaurante), sin tocar datos:
npm run preflight -- <restauranteId>

# Igual, pero incluyendo una prueba de humo real (crea y borra un pedido de
# verdad — ver la advertencia más abajo):
npm run preflight -- <restauranteId> --con-pedido-de-prueba

# Solo la infraestructura compartida (sin mirar ningún restaurante):
npm run preflight -- <restauranteId> --solo-infraestructura

# Solo el restaurante (sin repetir los chequeos de infraestructura, que no
# cambian de un restaurante a otro):
npm run preflight -- <restauranteId> --solo-restaurante

# Contra un build local en vez de producción:
npm run preflight -- <restauranteId> --base-url=http://localhost:4173
```

El `restauranteId` se copia del Panel Maestro (`/maestro`), debajo del
nombre de cada restaurante ("ID: ...").

Termina con código de salida `0` si todo quedó en verde (útil para
scripts/CI) y `1` si hay algo que arreglar.

## Qué verifica

**Infraestructura** (no depende de ningún restaurante):
Cloud Functions desplegadas y activas, reglas de Firestore/Storage
desplegadas = repositorio, el sitio en Vercel responde y sirve su propio
build, App Check rechaza lo no verificado y deja pasar lo verificado,
Point-in-Time Recovery y backups automáticos activos, alertas de
disponibilidad y de errores 5xx activas y notificando.

**El restaurante** que se le va a entregar: existe y tiene nombre, tiene
platos (y al menos uno disponible), tiene mesas con sus tokens de QR (y el
QR de la mesa 1 de verdad resuelve a una URL que responde), tiene horarios
configurados, tiene admin y cocina asignados, sus impuestos (si están
activos) tienen porcentajes razonables, y su portada pública carga con
botones válidos.

**Prueba de humo real** (opcional, `--con-pedido-de-prueba`): crea un
pedido de verdad contra `crearPedido` (la misma función que usa un cliente
real) en la mesa indicada (`--mesa=N`, por defecto 1), confirma que quedó
en Firestore con el estado correcto, confirma que aparece en la misma
consulta que usa la pantalla de Cocina, y lo borra — revirtiendo también
`stats.mesasPendientes`, `ventasDiarias` y los contadores de límite de
frecuencia que haya tocado, para dejar el restaurante exactamente como
estaba.

⚠️ **Por qué esta prueba es opcional y no corre por defecto:** escribe un
pedido real. Para un restaurante que todavía no ha recibido su primer
pedido (el caso normal antes de una entrega), esto es completamente seguro.
Si vas a correrla contra un restaurante que **ya está operando**, hazlo
fuera de horas pico — quien tenga Cocina abierta va a ver aparecer y
desaparecer ese pedido por uno o dos segundos.

## Qué NO hace

No modifica nada del restaurante que revisa (fuera de la prueba de humo
opcional, que revierte todo lo que toca). No reemplaza el ejército de
clientes virtuales (`clientes/`, `carga/`) — eso prueba la app a fondo
contra el restaurante de pruebas dedicado; esto es un chequeo rápido de
salud antes de una entrega puntual, contra cualquier restaurante.

## Diseño

- `gcp.js` — acceso a las APIs de Google Cloud (Cloud Functions, Firestore
  Admin, Cloud Monitoring, reglas de seguridad) con las credenciales ADC de
  `firebase login`, mismo mecanismo que ya usa el resto de `pruebas/`.
- `infraestructura.js` — chequeos que no dependen de un restaurante.
- `restaurante.js` — chequeos de un restaurante puntual (solo lectura).
- `humo.js` — la prueba de humo real, opcional.
- `reporte.js` — colector de resultados (verde/rojo/aviso) y el resumen
  final; ninguna verificación imprime directamente ni deja escapar un
  stack trace de Node.
- `index.js` — línea de comandos, orquesta todo lo anterior.
