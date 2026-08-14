# Ejército de clientes virtuales — MesaDigital

Sistema de pruebas de extremo a extremo y de carga contra un restaurante de
pruebas dedicado. Vive **fuera** de `src/` y `functions/` a propósito: no es
parte del build de Vite ni del despliegue de Cloud Functions — es una
carpeta hermana con su propio `package.json`.

**Estado actual: Fases 0 a 3 completas.** Fase 1 (corrección, 14 escenarios
con Playwright): 13/14 pasan, el que falla expone un bug real de la app (ver
"Hallazgos de Fase 1" abajo). Fase 2 (carga: 10→50→100→500 clientes
concurrentes): punto de quiebre encontrado en ~50 clientes concurrentes,
causado por contención de transacción de Firestore en
`stats.mesasPendientes` (ver `reporte/reporte-final.txt` para el reporte
completo). Fase 3 (`reporte/reporte.js`) genera ese reporte a partir de los
JSON crudos de las Fases 1 y 2.

## Qué existe ahora mismo

| Archivo | Qué hace | Estado |
|---|---|---|
| `config.js` | Configuración central (restauranteId de pruebas, credenciales, token de App Check) | Listo |
| `appcheck-debug-token.js` | Registra un token de depuración de App Check vía la API REST oficial | Listo, verificado |
| `setup.js` | Crea/reinicia el restaurante de pruebas (menú, mesas, horarios, impuestos) | Listo, verificado |
| `limpieza.js` | Borra pedidos y cuentas anónimas del restaurante de pruebas | Listo, verificado |
| `clientes/cliente.js` | Cliente virtual con navegador real (Playwright) — navega el acordeón, agrega platos, envía pedidos | Listo, verificado |
| `clientes/llamadaDirecta.js` | Cliente directo a `crearPedido` sin navegador, para escenarios de validación de servidor y Fase 2 | Listo, verificado |
| `clientes/escenarios.js` | Generación de datos variados con semilla (notas, cantidades) | Listo |
| `clientes/correr.js` | Orquesta los 14 escenarios obligatorios de Fase 1 | Listo — 13/14 pasan |
| `verificacion/firestore.js` | Lee y compara pedidos contra Firestore con el Admin SDK | Listo, verificado |
| `verificacion/cocina.js` | Abre `/cocina` con Playwright y lee las mesas visibles | Listo, verificado |
| `carga/carga.js` | Carga directa (sin navegador) a `crearPedido`, niveles 10→50→100→500 concurrentes | Listo — punto de quiebre encontrado |
| `reporte/reporte.js` | Sintetiza los JSON de Fase 1 y Fase 2 en el reporte final legible | Listo |

## Hallazgos de Fase 1

**Bug real confirmado en la app** (no en las pruebas): si TODOS los días de
`horarios` quedan con `cerrado:true` pero `abre`/`cierra` vacíos —una
combinación que el propio formulario de Admin.jsx permite guardar sin
avisar nada raro (su validación salta el chequeo de formato de hora
precisamente cuando `cerrado` es `true`)— tanto `src/utils/horarioRestaurante.js`
como su copia `functions/lib/horarioRestaurante.js` consideran que
"no hay horario configurado" (`tieneHorarioConfigurado` exige al menos un
día con `abre`/`cierra` parseable, sin importar `cerrado`) y por lo tanto
**no aplican ninguna restricción** — el restaurante queda efectivamente
SIEMPRE ABIERTO pese a que el dueño marcó los 7 días como cerrados. Se
reproduce con `crearPedido` llamado directamente: el servidor acepta el
pedido. Corresponde al escenario 11 ("restaurante cerrado por horario"),
que falla intencionalmente hasta que esto se corrija en el código de la
app — no se tocó `functions/` ni `src/` para "arreglarlo" desde acá,
conforme a la regla de no tocar código de producción.

Además, durante la construcción del harness aparecieron dos
comportamientos reales de la interfaz que vale la pena anotar aunque no
bloquean ningún escenario (ya rodeados en `clientes/cliente.js`, con
comentarios en el propio código):
- Con un viewport de altura estándar (720px) y 4 categorías en el menú, el
  encabezado de una categoría en flujo normal puede terminar en la misma
  franja de pantalla que la barra fija de abajo (carrito/enviar/llamar al
  mesero) y "ganarle" el pintado — un click ahí cae sobre el encabezado, no
  sobre la barra. Se evita usando un viewport más alto en las pruebas.
- El botón "Llamar al mesero" no responde a un click de mouse (real o
  sintético) en Chromium headless, aunque el handler de React funciona
  perfectamente si se invoca directo o vía teclado (foco + Enter) — algo en
  el flujo de reCAPTCHA Enterprise (App Check) parece consumir ese evento
  de mouse puntual en sesiones automatizadas. No se confirmó que afecte a
  usuarios reales; el harness usa Enter como respaldo.

## Cómo correr lo que ya existe

```bash
cd pruebas
npm install
npx playwright install chromium   # una sola vez

# 1. Registrar el token de depuración de App Check (una sola vez; se
#    guarda en .env.pruebas, que no se sube a git)
node appcheck-debug-token.js

# 2. Crear/reiniciar el restaurante de pruebas
node setup.js

# 3. (para probar el flujo real) build + preview local con la site key de
#    reCAPTCHA activa — NUNCA se usa esto contra la URL de producción real
export VITE_RECAPTCHA_SITE_KEY=<ver nota abajo>
cd .. && npm run build && npm run preview
# en otra terminal, contra http://localhost:4173 (o el puerto que use vite preview)

# 4. Limpiar después de cualquier corrida (o si una corrida falló a mitad)
cd pruebas && node limpieza.js
```

## Por qué esto NO toca producción

- **App Check**: el token de depuración se registra en la lista de
  "debug tokens" del proyecto, vía la API oficial de App Check
  (`firebaseappcheck.googleapis.com`). Un usuario real, sin ese token exacto,
  sigue necesitando pasar reCAPTCHA Enterprise igual que siempre — esto no
  desactiva ni debilita nada para nadie más. Es el mecanismo que Firebase
  documenta para pruebas automatizadas/CI.
- **Restaurante de pruebas**: vive bajo el ID fijo y legible
  `mesadigital-pruebas-ejercito-virtual` (nunca un ID autogenerado, para que
  sea imposible confundirlo con un restaurante real). `setup.js` solo toca
  ese documento y sus subcolecciones.
- **Build local**: las pruebas corren contra un `vite preview` local
  (`localhost`), nunca contra `mesadigital-pi.vercel.app`. El archivo
  `.env.local` con la site key de reCAPTCHA es local y está en
  `.gitignore` — nunca se despliega.
- **Reglas y funciones**: no se modificó `firestore.rules`, `storage.rules`
  ni `functions/index.js` para que esto funcionara.

## El token de depuración de App Check, en una frase

`self.FIREBASE_APPCHECK_DEBUG_TOKEN` es una variable global que el SDK de
App Check revisa antes de pedirle una verificación a reCAPTCHA. Si tiene un
string, lo usa como token de depuración en vez de hacer la verificación real
— y el backend lo acepta SOLO si ese string exacto está en la lista de
tokens de depuración del proyecto (la que arma `appcheck-debug-token.js`).
Playwright lo inyecta con `page.addInitScript` antes de que cargue
`firebase.js`, así el SDK lo encuentra ya puesto cuando se inicializa.

**Importante:** el propio `src/firebase.js` de la app, cuando
`VITE_APPCHECK_DEBUG=true`, pone `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`
(booleano) — eso hace que el SDK genere un token ALEATORIO nuevo cada vez
(pensado para desarrollo interactivo, no para CI). Para las pruebas
automatizadas, **no** se activa `VITE_APPCHECK_DEBUG` en el build; en su
lugar, Playwright inyecta el string exacto ya registrado. Así el mismo
token sirve corrida tras corrida sin tener que volver a registrarlo.

## Restaurante de pruebas

- **ID:** `mesadigital-pruebas-ejercito-virtual`
- **Contenido:** ver `_manifiestos/restaurante-prueba.json` (se regenera
  cada vez que corre `setup.js`) — 12 platos en 4 categorías (Entradas,
  Platos Fuertes, Bebidas con subcategorías Cervezas/Cócteles + caso mixto
  "Otros", Postres), un plato marcado agotado a propósito, ITBIS y propina
  activos, horarios abiertos casi todo el día, 5 mesas con token.
- **`setup.js` es destructivo solo dentro de este restaurante**: borra sus
  platos/pedidos/categorías anteriores antes de rearmar. Nunca toca ningún
  otro documento de `restaurantes/`.
