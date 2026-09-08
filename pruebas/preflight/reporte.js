// Colector de resultados del preflight — pensado para que la salida final la
// lea el propio Anderson (no un programador leyendo logs). Cada verificación
// llama a uno de los métodos de abajo; nunca imprime directamente ni deja
// pasar una excepción cruda — eso es justo lo que pide la tarea ("nada de
// trazas de error crudas").
//
// Tres estados, no dos:
// - ok       → verde, todo bien.
// - fallo    → rojo, hay que arreglar algo antes de entregar. Siempre trae
//              un `arreglo`: qué hacer, en lenguaje llano.
// - aviso    → amarillo, no bloquea la entrega pero vale la pena mirarlo (o
//              la verificación no se pudo hacer por falta de un dato/flag).

export class Reporte {
  constructor() {
    this.items = [];
    this.categoriaActual = null;
  }

  categoria(nombre) {
    this.categoriaActual = nombre;
    this.items.push({ tipo: 'categoria', nombre });
  }

  ok(titulo, detalle) {
    this.items.push({ tipo: 'resultado', estado: 'ok', titulo, detalle });
  }

  fallo(titulo, detalle, arreglo) {
    this.items.push({ tipo: 'resultado', estado: 'fallo', titulo, detalle, arreglo });
  }

  aviso(titulo, detalle, arreglo) {
    this.items.push({ tipo: 'resultado', estado: 'aviso', titulo, detalle, arreglo });
  }

  // Envuelve una verificación async: si lanza una excepción inesperada (red
  // caída, permiso faltante, typo en un campo), la convierte en un `fallo`
  // legible en vez de dejar que reviente el script entero o imprima un
  // stack trace de Node. Cada check individual sigue siendo independiente —
  // que uno falle no debe impedir que los demás corran.
  async ejecutar(titulo, fn) {
    try {
      await fn();
    } catch (e) {
      this.fallo(
        titulo,
        `No se pudo completar esta verificación: ${mensajeLegible(e)}`,
        'Revisa tu conexión a internet y que la sesión de `firebase login` siga activa (`firebase login --reauth`). Si el problema sigue, es un hallazgo en sí mismo — repórtalo, no es necesariamente un problema del restaurante.'
      );
    }
  }

  // ── Resumen final ──────────────────────────────────────────────────────
  imprimir() {
    console.log('');
    let categoriaImpresa = null;
    for (const item of this.items) {
      if (item.tipo === 'categoria') {
        console.log(`\n── ${item.nombre} ${'─'.repeat(Math.max(0, 60 - item.nombre.length))}`);
        categoriaImpresa = item.nombre;
        continue;
      }
      const icono = { ok: '✅', fallo: '❌', aviso: '⚠️ ' }[item.estado];
      console.log(`${icono} ${item.titulo}`);
      if (item.detalle) console.log(`   ${item.detalle}`);
      if (item.estado === 'fallo' && item.arreglo) console.log(`   → Cómo arreglarlo: ${item.arreglo}`);
      if (item.estado === 'aviso' && item.arreglo) console.log(`   → ${item.arreglo}`);
    }
    void categoriaImpresa;

    const resultados = this.items.filter((i) => i.tipo === 'resultado');
    const fallos = resultados.filter((i) => i.estado === 'fallo').length;
    const avisos = resultados.filter((i) => i.estado === 'aviso').length;
    const oks = resultados.filter((i) => i.estado === 'ok').length;

    console.log('\n' + '═'.repeat(64));
    if (fallos === 0) {
      console.log(`✅ LISTO PARA ENTREGAR — ${oks} verificaciones en verde${avisos ? `, ${avisos} avisos a revisar` : ''}.`);
    } else {
      console.log(`❌ NO ENTREGUES TODAVÍA — ${fallos} problema(s) que arreglar (ver arriba), ${oks} en verde, ${avisos} avisos.`);
    }
    console.log('═'.repeat(64) + '\n');

    return fallos === 0;
  }
}

// Nunca exponer un stack trace de Node — solo el mensaje, y solo la primera
// línea (algunos SDKs de Google meten el JSON entero del error en el mensaje).
function mensajeLegible(e) {
  const msg = (e && e.message) || String(e);
  return msg.split('\n')[0].slice(0, 300);
}
