// Un cliente virtual que usa la interfaz real (Playwright + navegador real)
// — abre su mesa, navega el acordeón, agrega/quita platos, escribe nota,
// envía el pedido. Cada instancia es su propia página/contexto de
// navegador con su propia sesión anónima (igual que un cliente real
// escaneando su propio QR).

import { chromium } from 'playwright';
import { APPCHECK_DEBUG_TOKEN, BASE_URL, RESTAURANTE_ID } from '../config.js';

export class ClienteVirtual {
  constructor({ mesa, token, baseUrl = BASE_URL, restauranteId = RESTAURANTE_ID, headless = true }) {
    this.mesa = mesa;
    this.token = token;
    this.baseUrl = baseUrl;
    this.restauranteId = restauranteId;
    this.headless = headless;
    this.browser = null;
    this.page = null;
    this.erroresConsola = [];
    this._categoriaAbierta = null;
    this._subcategoriaAbierta = null;
  }

  async abrir() {
    this.browser = await chromium.launch({ headless: this.headless });
    // Hallazgo real de la app (ver _clickRobusto): los encabezados de
    // categoría del acordeón están en flujo normal (position:relative) pero
    // pintan POR ENCIMA de la barra fija de abajo (carrito/enviar/llamar al
    // mesero) cuando coinciden en la misma franja de pantalla — y eso pasa
    // ya con el acordeón cerrado: con 4 categorías en un viewport de 720px
    // de alto, la última cae justo en esa franja. Un viewport mucho más
    // alto que cualquier contenido posible del menú de pruebas garantiza
    // que la barra fija (bottom:0, siempre pegada al borde inferior DEL
    // VIEWPORT) nunca coincide en pantalla con ningún encabezado o tarjeta
    // de plato, sin importar cuántas categorías/subcategorías estén
    // abiertas. Evita el bug de raíz en vez de perseguir puntos de clic
    // seguros — más robusto que la lógica de click en el borde de
    // _clickRobusto, que igual se deja como respaldo.
    this.page = await this.browser.newPage({ viewport: { width: 1280, height: 3000 } });
    // MenuAcordeon.jsx usa scrollIntoView({behavior:'smooth'}) al abrir una
    // categoría/subcategoría, EXCEPTO si prefers-reduced-motion está activo
    // (usePrefersReducedMotion), en cuyo caso el scroll es instantáneo. Sin
    // esto, un click justo después de abrir una categoría puede caer sobre
    // el encabezado todavía en pleno scroll animado y ser interceptado por
    // él — no es un bug de la app, es una carrera entre el click y una
    // animación que la propia app ya sabe cómo desactivar.
    await this.page.emulateMedia({ reducedMotion: 'reduce' });
    // Debe correr ANTES de que cargue cualquier script de la app — ver
    // pruebas/README.md "El token de depuración de App Check, en una frase".
    await this.page.addInitScript((token) => {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    }, APPCHECK_DEBUG_TOKEN);
    this.page.on('console', (m) => { if (m.type() === 'error') this.erroresConsola.push(m.text()); });
    this.page.on('pageerror', (e) => this.erroresConsola.push(String(e)));

    const url = `${this.baseUrl}/restaurante/${this.restauranteId}/menu/${this.mesa}?t=${this.token}`;
    await this.page.goto(url, { waitUntil: 'load' });
    await this.page.waitForSelector('h1', { timeout: 15000 });
    await this.page.waitForTimeout(1200); // auth anónima + primera entrega de suscripciones
  }

  // Navega el acordeón hasta el plato por nombre exacto y lo agrega
  // `cantidad` veces. Necesita saber categoría/subcategoría (del manifiesto
  // de setup.js) para abrir los niveles correctos — el acordeón no tiene
  // una búsqueda "ir directo a", hay que abrirlo como lo haría una persona.
  async agregarPlato({ nombre, categoria, subcategoria }, cantidad = 1) {
    await this._asegurarPlatoVisible(nombre, categoria, subcategoria);
    const boton = await this._botonAgregarDe(nombre);
    for (let i = 0; i < cantidad; i++) {
      await this._clickRobusto(boton);
      await this.page.waitForTimeout(250);
    }
  }

  async quitarPlato({ nombre, categoria, subcategoria }, veces = 1) {
    await this._asegurarPlatoVisible(nombre, categoria, subcategoria);
    const tarjeta = await this._tarjetaDe(nombre);
    const menos = tarjeta.locator('button', { hasText: '−' });
    for (let i = 0; i < veces; i++) {
      await this._clickRobusto(menos);
      await this.page.waitForTimeout(250);
    }
  }

  // Tres niveles de intento, del más fiel a un click real al más forzado:
  // 1) click normal (falla si algo cubre el centro del elemento — puede
  //    pasar transitoriamente durante la animación del acordeón).
  // 2) click en el borde derecho del elemento en vez del centro — hallazgo
  //    real de la app, no solo un problema del harness: cuando una
  //    categoría está abierta, el encabezado de la SIGUIENTE categoría
  //    (posicionado en flujo normal) puede terminar ocupando la misma
  //    franja vertical que la barra fija del carrito/enviar (posición
  //    fixed, siempre pegada abajo), y como ese encabezado cubre la franja
  //    central (x≈400-880 en un viewport de 1280), el CENTRO de la barra
  //    fija (donde Playwright hace click por defecto) cae sobre el
  //    encabezado en vez de la barra. El borde derecho de la barra fija
  //    normalmente cae fuera del ancho del encabezado. Reportado en el
  //    reporte de Fase 3 como hallazgo de UI, no "arreglado" acá.
  // 3) force:true como último recurso, si ninguno de los anteriores dio.
  async _clickRobusto(locator, intentos = 3) {
    for (let i = 0; i < intentos; i++) {
      try {
        await locator.click({ timeout: 8000 });
        return;
      } catch (e) {
        if (i === intentos - 1) {
          const caja = await locator.boundingBox().catch(() => null);
          if (caja) {
            const x = caja.x + caja.width - 15;
            const y = caja.y + caja.height / 2;
            const cae_dentro = await locator.evaluate((el, [px, py]) => {
              const enElPunto = document.elementFromPoint(px, py);
              return !!enElPunto && (enElPunto === el || el.contains(enElPunto));
            }, [x, y]).catch(() => false);
            if (cae_dentro) {
              await this.page.mouse.click(x, y);
              return;
            }
          }
          await locator.click({ force: true, timeout: 5000 });
          return;
        }
        await this.page.waitForTimeout(500);
      }
    }
  }

  // Abre categoría (y subcategoría, si aplica) SOLO si el plato todavía no
  // está visible — evita el problema de "detectar si ya está abierto"
  // leyendo la rotación del chevron (frágil); en vez de eso, comprueba
  // directamente lo que de verdad importa: si el contenido buscado ya se
  // puede ver.
  async _asegurarPlatoVisible(nombrePlato, categoria, subcategoria) {
    if (await this._visible(this.page.getByText(nombrePlato, { exact: true }))) return;

    await this._clickBotonConTexto(categoria);
    this._categoriaAbierta = categoria;
    await this.page.waitForTimeout(500);

    if (!(await this._visible(this.page.getByText(nombrePlato, { exact: true })))) {
      // Un plato sin subcategoria propia, en una categoría que SÍ tiene
      // subcategorías en otros platos (p.ej. Agua en Bebidas, junto a
      // Cervezas/Cócteles), cae bajo el cajón "Otros" que MenuAcordeon
      // arma automáticamente (ver src/utils/menuCategorias.js, OTROS) —
      // es un nivel más del acordeón, con su propio encabezado clicable.
      const etiqueta = subcategoria || 'Otros';
      await this._clickBotonConTexto(etiqueta);
      this._subcategoriaAbierta = etiqueta;
      await this.page.waitForTimeout(500);
    }

    await this.page.getByText(nombrePlato, { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  }

  // Hallazgo real de la app (documentado junto a _clickRobusto): con una
  // categoría abierta, la página crece lo suficiente para que el
  // encabezado de OTRA categoría (en flujo normal) termine ocupando la
  // misma franja de pantalla que la barra fija de abajo (carrito/enviar/
  // llamar al mesero), y un click ahí cae sobre el encabezado en vez de la
  // barra — el "click en el borde" de _clickRobusto es un parche puntual,
  // pero con notas largas el panel del carrito crece tanto que hasta el
  // borde queda cubierto. La forma confiable de evitarlo del todo es
  // cerrar la categoría/subcategoría abierta antes de tocar la barra fija,
  // devolviendo la página a su altura mínima.
  async _cerrarAcordeonAbierto() {
    if (this._subcategoriaAbierta) {
      await this._clickBotonConTexto(this._subcategoriaAbierta);
      this._subcategoriaAbierta = null;
      await this.page.waitForTimeout(300);
    }
    if (this._categoriaAbierta) {
      await this._clickBotonConTexto(this._categoriaAbierta);
      this._categoriaAbierta = null;
      await this.page.waitForTimeout(300);
    }
  }

  async _visible(locator) {
    try { return await locator.first().isVisible(); } catch { return false; }
  }

  async _clickBotonConTexto(texto) {
    const boton = this.page.locator('button', { hasText: texto }).first();
    await boton.waitFor({ state: 'visible', timeout: 10000 });
    await this._clickRobusto(boton);
  }

  // Localiza la tarjeta del plato por el nombre EXACTO de su <p> de título
  // (no substring — "Cerveza" no debe matchear "Cerveza Presidente" Y
  // "Cerveza Corona" a la vez), y sube hasta el contenedor de la tarjeta.
  async _tarjetaDe(nombreExacto) {
    const titulo = this.page.getByText(nombreExacto, { exact: true });
    return titulo.locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
  }

  async _botonAgregarDe(nombreExacto) {
    const tarjeta = await this._tarjetaDe(nombreExacto);
    // Antes de agregar: "+ Agregar" (con label). Después de la primera
    // unidad: solo "+". Cubre ambos casos con un solo selector por texto
    // parcial "+", que matchea ambos botones en cualquier momento.
    return tarjeta.locator('button', { hasText: '+' }).last();
  }

  // reCAPTCHA Enterprise inyecta su propio <textarea id="g-recaptcha-response">
  // oculto en el documento — 'textarea' a secas matchea ese Y el de la
  // nota, así que todo lo que toca el textarea de la nota se limita
  // explícitamente al visible.
  async escribirNota(texto) {
    await this._abrirCarritoSiHaceFalta();
    await this.page.locator('textarea:visible').fill(texto);
  }

  async _abrirCarritoSiHaceFalta() {
    const textarea = this.page.locator('textarea:visible');
    if (await textarea.count() === 0 || !(await textarea.isVisible().catch(() => false))) {
      await this._cerrarAcordeonAbierto();
      const boton = this.page.locator('button', { hasText: /ítem|item/i }).first();
      await boton.waitFor({ state: 'visible', timeout: 10000 });
      await this._clickRobusto(boton);
      await this.page.waitForTimeout(400);
    }
  }

  async enviarPedido() {
    await this._abrirCarritoSiHaceFalta();
    // Pequeño respiro antes de leer el estado del botón: escribirNota()
    // acaba de hacer fill() justo antes de esta llamada en varios
    // escenarios, y sin este margen se puede leer el botón a mitad de un
    // re-render de React.
    await this.page.waitForTimeout(200);
    const boton = this.page.locator('button', { hasText: /Enviar pedido|Send order/i });
    const deshabilitado = await boton.isDisabled().catch(() => true);
    if (deshabilitado) {
      return { enviado: false, razon: 'boton-deshabilitado' };
    }
    // El aviso de éxito de una ronda anterior queda en pantalla hasta 5s
    // (setTimeout en Menu.jsx) — en "mismo cliente, varias rondas" la
    // segunda ronda puede hacer click mientras el aviso de la primera
    // TODAVÍA está visible. Sin este drenado, el sondeo de más abajo
    // detectaría ese aviso viejo en la primera vuelta (i=0) y reportaría
    // éxito para la ronda 2 sin haber esperado su propia respuesta.
    const aviso0 = this.page.locator('.fixed.top-4');
    for (let i = 0; i < 12 && (await aviso0.count()) > 0; i++) {
      await this.page.waitForTimeout(500);
    }
    await this._clickRobusto(boton);
    // El texto del aviso de éxito NO es fijo ("¡Pedido enviado!" solo se usa
    // si el carrito no tenía ni comida ni bebida, algo que no pasa en la
    // práctica) — Menu.jsx arma un mensaje distinto según el pedido
    // ("🍽️ Tu comida tardará…", "🥤 Tu bebida tardará…"), así que detectar
    // por contenido de texto es frágil. Ambos avisos (éxito y error)
    // comparten el mismo contenedor `.fixed.top-4…`; se distinguen por el
    // color de fondo de adentro (ámbar=éxito, rojo=error) — eso sí es
    // estable porque Menu.jsx nunca los mezcla.
    //
    // Se sondea en vez de esperar un tiempo fijo — un cold start de la
    // Cloud Function puede tardar más que un tiempo fijo corto, y esperar
    // siempre el máximo alarga cada escenario sin necesidad.
    const aviso = this.page.locator('.fixed.top-4');
    let huboExito = false;
    let huboError = false;
    for (let i = 0; i < 20; i++) {
      huboExito = await aviso.locator('.bg-amber-400').count() > 0;
      huboError = await aviso.locator('.bg-red-500').count() > 0;
      if (huboExito || huboError) break;
      await this.page.waitForTimeout(500);
    }
    let textoError = null;
    if (huboError) textoError = await aviso.locator('.bg-red-500').first().textContent().catch(() => null);
    return { enviado: huboExito, error: huboError, textoError };
  }

  // Hallazgo del entorno de pruebas, no de la app: un click de mouse
  // "exitoso" (sin excepción, sin interceptación geométrica, con
  // elementFromPoint confirmando el botón correcto) en ESTE botón puntual
  // no dispara el onClick de React en Chromium headless — verificado
  // comparando click real de mouse (Playwright), click nativo del DOM
  // (btn.click()) e invocación directa de la prop __reactProps.onClick:
  // solo la invocación directa y la activación por teclado (foco + Enter)
  // funcionan. El evento sí llega a burbujear hasta document/window/root
  // (confirmado con un listener de prueba), así que no es un problema de
  // interceptación de puntero — algo en el flujo de reCAPTCHA Enterprise
  // (App Check), que solo este botón dispara al ser el primer/único botón
  // interactivo con el carrito vacío, parece consumir el evento de mouse en
  // sesiones automatizadas. Enter con foco es una forma legítima de activar
  // un botón (equivalente a como lo haría un usuario de teclado/lector de
  // pantalla), así que se usa como respaldo real, no como atajo que se
  // salte la interfaz.
  async llamarMesero() {
    await this._cerrarAcordeonAbierto();
    const boton = this.page.locator('button', { hasText: /Llamar al mesero|Call the waiter/i }).first();
    await boton.waitFor({ state: 'visible', timeout: 10000 });
    await this._clickRobusto(boton);
    await this.page.waitForTimeout(600);
    const siguioSinNotificar = await boton.textContent()
      .then((texto) => /Llamar al mesero|Call the waiter/i.test(texto))
      .catch(() => false);
    if (siguioSinNotificar) {
      await boton.focus();
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(600);
    }
  }

  async avisoRestauranteCerradoVisible() {
    return (await this.page.locator('text=/cerrado en este momento|closed right now/i').count()) > 0;
  }

  async cerrar() {
    await this.browser?.close().catch(() => {});
  }
}
