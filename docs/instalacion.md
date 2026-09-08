# Guía de instalación — poner un restaurante nuevo en marcha

Checklist paso a paso para dar de alta un restaurante en MesaDigital, desde
crearlo en el Panel Maestro hasta que el dueño pueda recibir su primer
pedido real. Sigue el orden — cada paso depende del anterior.

No asume que ya sabes nada de la app. Si algo de esto describe una pantalla
distinta a la que ves, la app cambió desde que se escribió esto — avísate a
ti mismo para actualizar esta guía.

---

## 0. Antes de sentarte a configurar — pídele esto al restaurante

- [ ] Nombre exacto del restaurante (como quieren que aparezca al cliente).
- [ ] Un correo de contacto por cada persona que va a tener acceso al panel
      (mínimo: el dueño/admin). No hace falta que sea el correo del
      negocio — puede ser el personal de cada quien.
- [ ] Número de mesas físicas que va a tener QR.
- [ ] Horario real de atención, día por día (incluyendo si cruza medianoche,
      ej. "viernes 5pm–2am").
- [ ] ¿Cobran ITBIS por separado? ¿Cobran propina legal (10%)? Si sí, a
      cuál(es) categoría de plato aplica (normalmente a todo el menú).
- [ ] El menú completo: nombre, precio, categoría (y subcategoría si aplica,
      ej. Bebidas → Cervezas/Cócteles), descripción, tiempo de preparación
      aproximado, y foto de cada plato si tienen.
- [ ] Logo, una foto de portada (la que se ve al abrir el link general del
      restaurante), y un eslogan corto — opcional pero mejora mucho la
      primera impresión.
- [ ] Redes/contacto que quieran mostrar en la portada: WhatsApp,
      Instagram, Google Maps, teléfono.

---

## 1. Crear el restaurante

- [ ] Entra a `/maestro` con tu cuenta.
- [ ] Campo "Nuevo restaurante" → escribe el nombre exacto → **Crear**.
- [ ] Copia el **ID** que aparece bajo el nombre (lo vas a necesitar en
      cada paso siguiente y para el preflight al final).

## 2. Dar acceso al dueño (admin) y a cocina

Método recomendado — invitación por correo (la persona crea su propia
contraseña, tú nunca la conoces):

- [ ] En la tarjeta del restaurante → "Gestionar acceso" → **Invitar admin**.
- [ ] Copia el enlace de invitación y envíaselo al dueño (WhatsApp, correo).
      Válido 7 días.
- [ ] El dueño abre el enlace, pone su correo, recibe un código de 6 dígitos,
      lo confirma y crea su contraseña. Queda con acceso automáticamente.
- [ ] Repite con **Invitar cocina** para quien vaya a usar esa pantalla (si
      es una persona distinta del dueño).

Si alguien ya tiene cuenta y prefieres agregarlo directo: que entre a
`/restaurante/{id}/admin` (o `/cocina`), copie su UID de la pantalla "Sin
acceso", y pégalo tú en el campo correspondiente ("Admins"/"Cocina") de
"Gestionar acceso".

- [ ] Verifica que **al menos un admin** y **al menos una persona de
      cocina** queden asignados (puede ser la misma persona en ambos).

## 3. Cargar el menú (como el admin, o tú mismo temporalmente)

- [ ] Entra a `/restaurante/{id}/admin`.
- [ ] Agrega cada plato: nombre, precio, categoría, descripción, tiempo de
      preparación, foto (sube una imagen o pega una URL — máx. 3MB si subes
      archivo). Repite hasta tener el menú completo.
- [ ] Si el restaurante usa subcategorías (ej. Bebidas → Cervezas), agrégalas
      al escribir la categoría del plato con el formato que use el
      formulario.
- [ ] Revisa que **ningún plato real quede marcado como agotado** por
      accidente antes de abrir.
- [ ] Define el orden de aparición de los platos si el dueño tiene
      preferencia (si no, el orden por defecto está bien).

## 4. Horarios

- [ ] Admin → Horarios → configura cada día (hora de apertura, hora de
      cierre, o "cerrado" si ese día no abren).
- [ ] Si algún día cruza medianoche (ej. cierra 2am), ponlo tal cual —
      el sistema lo entiende automáticamente.
- [ ] Guarda y confirma que la píldora de "abierto/cerrado" de la portada
      (paso 7) refleje la hora correcta.

## 5. Impuestos

- [ ] Admin → Impuestos → activa ITBIS si aplica, pon el porcentaje (18%
      es el legal en RD, no lo cambies salvo que el dueño confirme algo
      distinto).
- [ ] Activa propina legal si aplica (10% es lo usual).
- [ ] Si ninguno aplica, déjalos ambos desactivados — no hace falta tocar
      nada más.

## 6. Marca y portada

- [ ] Admin → sube logo y foto de portada, escribe el eslogan y la
      dirección.
- [ ] Admin → Portada → agrega los botones que quiera el restaurante
      (mínimo recomendado: **Ver carta**, para que quien llegue por
      Instagram/Google pueda ver el menú sin escanear ningún QR). Agrega
      WhatsApp, mapa, Instagram o teléfono según lo que te hayan dado en
      el paso 0.
- [ ] Guarda y revisa la portada en vivo: `/restaurante/{id}`.

## 7. Mesas y QR

- [ ] Vuelve a `/maestro` → en la tarjeta del restaurante, escribe el
      número de mesas en "Número de mesas". Esto genera un token por mesa
      automáticamente.
- [ ] Para cada mesa, botón **Imprimir** → imprime el QR (o descárgalo como
      PNG si vas a mandarlo a imprenta). Ponle el QR a cada mesa física
      antes de abrir.
- [ ] **Nunca** reuses o fotocopies el QR de una mesa para otra — cada uno
      tiene un token distinto.

---

## 8. Antes de decir "listo" — corre la verificación

- [ ] Desde tu máquina: `cd pruebas && npm run preflight -- <restauranteId>`
- [ ] Corrige todo lo que salga en rojo. Los avisos en amarillo revísalos
      con criterio (algunos son decisiones válidas del restaurante, como no
      tener impuestos activos).
- [ ] Cuando esté todo en verde (o solo avisos esperados), corre otra vez
      agregando `--con-pedido-de-prueba` — esto crea y borra un pedido real
      de punta a punta, la prueba más parecida a un cliente real pidiendo.
- [ ] Escanea tú mismo un QR real con tu celular (datos móviles, no tu
      WiFi) y haz un pedido de prueba manual, para verlo con tus propios
      ojos llegar a Cocina.

No digas "listo" hasta que el preflight completo (con la prueba de pedido)
quede en verde.

---

## 9. Qué enseñarle al dueño (Admin)

- [ ] Cómo entrar y salir de sesión.
- [ ] Agregar/editar/desactivar un plato (y la diferencia entre
      "desactivar" y "eliminar").
- [ ] Cambiar un precio.
- [ ] Ver ventas del día/semana/mes y descargar el PDF de cierre.
- [ ] Cómo cerrar una mesa manualmente si un cliente se fue sin que cocina
      la archivara.
- [ ] Entrégale impreso `docs/contingencias.md`.

## 10. Qué enseñarle a cocina

- [ ] Cómo entrar y salir de sesión.
- [ ] Leer una tarjeta de mesa: platos, nota del cliente, tiempo
      transcurrido, aviso de "pedido demorado".
- [ ] Marcar una mesa como lista, y archivarla cuando el cliente ya se fue.
- [ ] Atender/descartar una llamada de mesero.
- [ ] Marcar un plato como agotado desde la propia pantalla de Cocina (sin
      entrar a Admin) — muéstraselo en vivo, es la acción que más van a
      usar bajo presión.
- [ ] Activar el sonido de alertas.
- [ ] Qué hacer si cierran la pestaña sin querer (nada se pierde, solo
      reabrir e iniciar sesión).
- [ ] Entrégale (o pégale en la pared) `docs/contingencias.md`.

## 11. Qué entregarle por escrito

- [ ] `docs/contingencias.md` impreso, pegado en la cocina.
- [ ] El link de la portada (`/restaurante/{id}`) y de la carta pública
      (`/restaurante/{id}/carta`) — para que los usen en redes sociales.
- [ ] Los QR ya impresos, uno por mesa, colocados.
- [ ] Tu número de contacto para emergencias.
- [ ] (Opcional) Un correo breve resumiendo qué se configuró y con qué
      correos quedaron admin/cocina — para que quede un registro fuera de
      tu propia cabeza.

---

Cuando termines los 11 pasos y el preflight esté en verde, el restaurante
puede recibir su primer pedido real.
