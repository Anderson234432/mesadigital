// Abre /cocina con Playwright, autenticado como la cuenta de staff de
// pruebas (creada por setup.js, solo con acceso a este restaurante), y lee
// lo que un cocinero real vería — para comparar contra lo que se guardó en
// Firestore. Esta es la parte que más valor tiene: un desajuste entre lo
// que se guarda y lo que se MUESTRA en cocina no lo detecta ninguna
// lectura directa a Firestore, solo mirar la pantalla real.

import { chromium } from 'playwright';
import { BASE_URL, RESTAURANTE_ID } from '../config.js';

export async function abrirCocina({ email, password, restauranteId = RESTAURANTE_ID, baseUrl = BASE_URL, headless = true }) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  const erroresConsola = [];
  page.on('console', (m) => { if (m.type() === 'error') erroresConsola.push(m.text()); });
  page.on('pageerror', (e) => erroresConsola.push(String(e)));

  await page.goto(`${baseUrl}/restaurante/${restauranteId}/cocina`, { waitUntil: 'load' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('h1:has-text("Cocina")', { timeout: 15000 });
  await page.waitForTimeout(1500); // suscripciones en vivo

  return { browser, page, erroresConsola };
}

// Lee todas las tarjetas de mesa visibles y las estructura igual que
// Cocina.jsx las agrupa internamente — para poder comparar 1 a 1 contra lo
// esperado por el escenario, no solo "¿aparece el texto en algún lado?".
export async function leerMesasVisibles(page) {
  return page.evaluate(() => {
    const tarjetas = [...document.querySelectorAll('h2')].filter((h) => /^Mesa /.test(h.textContent));
    return tarjetas.map((h2) => {
      const tarjeta = h2.closest('div.border, div[class*="border"]');
      const items = [...tarjeta.querySelectorAll('ul li')].map((li) => li.textContent.trim());
      const totalTexto = [...tarjeta.querySelectorAll('p')].find((p) => /^Total: RD\$/.test(p.textContent));
      const estadoTexto = tarjeta.querySelector('span')?.textContent?.trim() || '';
      return {
        mesa: h2.textContent.replace('Mesa ', '').trim(),
        items,
        total: totalTexto ? Number(totalTexto.textContent.replace('Total: RD$', '')) : null,
        estado: estadoTexto,
        tieneAlertaLlamada: tarjeta.textContent.includes('solicita atención'),
      };
    });
  });
}

export async function cerrarCocina({ browser }) {
  await browser?.close().catch(() => {});
}
