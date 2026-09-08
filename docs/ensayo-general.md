# Ensayo general — simular un turno completo antes del primer cliente real

Esto no es una prueba automatizada — eres tú, con teléfonos de verdad,
actuando como si fuera un servicio real. El objetivo es sentir el sistema
bajo presión, con manos y ojos reales, antes de que un restaurante dependa
de él.

Sirve tanto contra el restaurante de pruebas (`pruebas/` — RESTAURANTE_ID
en `pruebas/config.js`) para un ensayo genérico del sistema, como contra un
restaurante real ya casi listo para abrir, con su propio menú — esta
segunda opción es más realista y la recomendada si ya llegaste hasta el
paso 8 de `docs/instalacion.md`.

Bloquea 45–60 minutos sin interrupciones. Necesitas al menos 2–3 celulares
(pide ayuda a alguien si puedes — simular "hora pico" solo es convincente
con más de una persona pidiendo a la vez) y un dispositivo aparte para
Cocina.

Anota en cada paso: **hora**, **qué pasó**, **qué esperabas que pasara**. Al
final hay una tabla para marcar qué funcionó.

---

## 0. Preparación

- [ ] El preflight (`npm run preflight -- <restauranteId>`) está en verde.
- [ ] QR de al menos 3 mesas impresos o visibles en pantalla.
- [ ] Un dispositivo con la pantalla de Cocina abierta, sesión iniciada,
      sonido activado, permiso de notificaciones concedido.
- [ ] Un dispositivo con Admin abierto (para revisar ventas al cierre).
- [ ] 2 o más celulares con datos móviles (no WiFi del mismo router que
      Cocina, para que las interrupciones de red sean realistas).
- [ ] Papel y lápiz para anotar totales esperados a mano — al cierre los
      comparas contra lo que muestra Admin.

## 1. Apertura — primeros pedidos

- [ ] Escanea el QR de la mesa 1 con un celular. Confirma que carga el
      menú (nombre del restaurante correcto, platos con foto y precio).
- [ ] Agrega 1–2 platos, escribe una nota corta para cocina, envía el
      pedido.
- [ ] **Cronometra** cuánto tarda en aparecer en Cocina (debería ser casi
      instantáneo — segundos, no minutos).
- [ ] Confirma que sonó la alerta y que la nota del cliente se ve completa.
- [ ] Marca la mesa como lista desde Cocina. Confirma que en el celular del
      "cliente" el banner cambia a verde.
- [ ] Archiva la mesa. Confirma que desaparece de Cocina.

## 2. Hora pico — varios pedidos, varias mesas

- [ ] Con 3–4 celulares a la vez (o uno detrás de otro lo más rápido
      posible), pide desde mesas distintas (2, 3, 4...).
- [ ] En al menos una mesa, envía una **segunda ronda** unos minutos
      después de la primera (simula "pidieron más"). Confirma que Cocina
      la agrupa bajo la misma mesa y avisa de "nueva orden" si pasó
      suficiente tiempo.
- [ ] En otra mesa, toca **"Llamar al mesero"** sin pedir nada. Confirma
      que se ve la alerta destacada en Cocina y que "Atendido" la
      descarta.
- [ ] Revisa que ninguna mesa se mezcló con otra y que los totales por
      mesa suman correctamente.

## 3. Interrupciones a propósito

Esta es la parte que más importa — un sistema que solo funciona en
condiciones perfectas no sirve para un restaurante real.

- [ ] **Apaga los datos del celular a mitad de un pedido** (después de
      tocar "Enviar", antes de que confirme). Espera unos segundos, vuelve
      a activar los datos. Anota: ¿qué mensaje vio el "cliente"?, ¿el
      pedido terminó llegando a Cocina una sola vez (no duplicado)?
- [ ] **Cierra la pestaña de Cocina** con una mesa activa pendiente.
      Vuelve a abrirla e inicia sesión de nuevo. Confirma que la mesa
      pendiente sigue ahí, sin nada perdido.
- [ ] **Marca un plato como agotado** (desde Cocina) mientras otro celular
      lo tiene YA agregado en su carrito, y luego intenta enviarlo. Anota
      el mensaje de error que recibe el cliente — debe ser claro, no un
      error técnico.
- [ ] (Si puedes) **Apaga por completo el WiFi/router del lugar** donde
      esté Cocina un momento, con un pedido en camino desde otro celular
      con datos propios. Confirma que el pedido del cliente sí llega
      apenas Cocina recupera conexión, y que Cocina se reconecta sola al
      volver la señal (o con un simple refresh).
- [ ] Intenta cargar el menú con una URL de mesa **con el token cambiado a
      mano** (edita el `?t=...` de la URL). Confirma que se rechaza de
      forma clara, no con una pantalla en blanco.

## 4. Cierre

- [ ] Archiva cualquier mesa que haya quedado activa del ensayo.
- [ ] Ve a Admin → Ventas → pestaña "Día". Compara el total y la cantidad
      de pedidos contra lo que anotaste a mano durante el ensayo.
- [ ] Descarga el PDF de cierre de caja. Ábrelo y confirma que el detalle
      de cada pedido coincide con lo que realmente se "pidió".
- [ ] Revisa el ranking de platos más pedidos — debe reflejar lo que de
      verdad se pidió más durante el ensayo.

## 5. Limpieza

- [ ] Si usaste el restaurante de pruebas: `cd pruebas && npm run limpieza`.
- [ ] Si usaste un restaurante real a punto de abrir: borra manualmente
      (o con `--con-pedido-de-prueba` del preflight, que ya limpia lo
      suyo) cualquier pedido de ensayo antes de la apertura real, para que
      el reporte de ventas del primer día no arrastre datos falsos.

---

## Tabla de resultados

| Paso | Funcionó | Notas |
|---|---|---|
| Apertura — primer pedido llega a Cocina | ☐ Sí ☐ No | |
| Apertura — mesa lista → banner verde en el cliente | ☐ Sí ☐ No | |
| Hora pico — varias mesas sin mezclarse | ☐ Sí ☐ No | |
| Hora pico — segunda ronda agrupada correctamente | ☐ Sí ☐ No | |
| Hora pico — llamar al mesero se ve y se descarta | ☐ Sí ☐ No | |
| Interrupción — datos apagados a mitad de pedido | ☐ Sí ☐ No | |
| Interrupción — cerrar/reabrir pestaña de Cocina | ☐ Sí ☐ No | |
| Interrupción — plato agotado mientras lo pedían | ☐ Sí ☐ No | |
| Interrupción — WiFi del local caído | ☐ Sí ☐ No | |
| Interrupción — token de mesa inválido rechazado | ☐ Sí ☐ No | |
| Cierre — ventas del día cuadran con lo anotado a mano | ☐ Sí ☐ No | |
| Cierre — PDF de cierre de caja correcto | ☐ Sí ☐ No | |

Si algo quedó en "No", no es necesariamente un bug — puede ser una
confusión de interfaz, un tiempo de espera más largo de lo esperado, o
un hallazgo real. Anótalo con el detalle suficiente para investigarlo
después, con calma, fuera del ensayo.
