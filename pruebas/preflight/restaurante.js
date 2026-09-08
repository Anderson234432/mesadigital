// Verificaciones específicas del restaurante que se va a entregar. Todo lo
// que hay aquí es de SOLO LECTURA sobre ese restaurante — nada se modifica.
// (La prueba de humo real, que sí escribe y borra un pedido, vive aparte en
// humo.js y es opcional.)

import { db } from './gcp.js';

// ── Horarios: reimplementación mínima de tieneHorarioConfigurado ─────────
// Copiado a propósito de src/utils/horarioRestaurante.js (misma razón que
// la duplicación entre src/utils/ y functions/lib/ documentada en ese
// archivo: pruebas/ es un paquete de Node aparte, sin acceso al bundle de
// Vite). Si esa función cambia, esta copia también debe cambiar.
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
function horaValida(horaStr) {
  return /^([0-1]\d|2[0-3]):([0-5]\d)$/.test(horaStr || '');
}
function diaTieneConfiguracion(horarioDelDia) {
  if (!horarioDelDia) return false;
  if (horarioDelDia.cerrado) return true;
  return horaValida(horarioDelDia.abre) && horaValida(horarioDelDia.cierra);
}
function tieneHorarioConfigurado(horarios) {
  if (!horarios || typeof horarios !== 'object') return false;
  return DIAS.some((d) => diaTieneConfiguracion(horarios[d]));
}
function todosLosDiasCerrados(horarios) {
  if (!horarios) return false;
  return DIAS.every((d) => horarios[d]?.cerrado === true);
}

// ── Botones de portada: reimplementación mínima de destinoBotonValido ────
// Copiado de src/utils/contacto.js — mismo motivo que arriba.
function botonValido(tipo, destino) {
  const v = (destino || '').trim();
  switch (tipo) {
    case 'carta': return true;
    case 'mapa':
    case 'enlace': return /^https?:\/\//i.test(v);
    case 'whatsapp': return v.replace(/\D/g, '').length > 0;
    case 'telefono': return v.replace(/\D/g, '').length > 0;
    case 'instagram': return v.length > 0;
    default: return true;
  }
}

async function fetchEstado(url) {
  try {
    const res = await fetch(url);
    return res.status;
  } catch (e) {
    return `error de red (${e.message})`;
  }
}

export async function verificarRestaurante(reporte, restauranteId, { baseUrl }) {
  reporte.categoria(`Restaurante: ${restauranteId}`);

  const snap = await db.collection('restaurantes').doc(restauranteId).get();
  if (!snap.exists) {
    reporte.fallo(
      'El restaurante existe',
      `No existe ningún documento restaurantes/${restauranteId} en Firestore.`,
      'Verifica el ID — cópialo del Panel Maestro, no lo escribas a mano. Si es un restaurante nuevo, créalo primero desde /maestro.'
    );
    return; // nada más tiene sentido revisar sin el documento
  }
  const r = snap.data();

  if (r.nombre && r.nombre.trim().length > 0) {
    reporte.ok('Nombre configurado', `"${r.nombre}"`);
  } else {
    reporte.fallo('Nombre configurado', 'El campo "nombre" está vacío.', 'Ponle nombre desde el Panel Maestro (botón "Editar" junto al nombre).');
  }

  // ── Platos ────────────────────────────────────────────────────────────
  await reporte.ejecutar('Menú (platos)', async () => {
    const platosSnap = await db.collection('restaurantes').doc(restauranteId).collection('platos').get();
    const platos = platosSnap.docs.map((d) => d.data());
    if (platos.length === 0) {
      reporte.fallo('Tiene platos', 'La colección de platos está vacía.', 'Carga al menos un plato desde Admin → agregar plato.');
    } else {
      reporte.ok('Tiene platos', `${platos.length} plato(s) en el menú.`);
      const disponibles = platos.filter((p) => p.disponible !== false).length;
      if (disponibles === 0) {
        reporte.fallo(
          'Al menos un plato disponible',
          'Los platos existen pero TODOS están marcados como agotados/no disponibles.',
          'Revisa Admin → lista de platos, o el panel de disponibilidad en Cocina, y marca al menos uno como disponible. Con el menú así, ningún cliente puede pedir nada.'
        );
      } else {
        reporte.ok('Al menos un plato disponible', `${disponibles} de ${platos.length} disponibles.`);
      }
    }
  });

  // ── Mesas y tokens ────────────────────────────────────────────────────
  const numMesas = Number(r.numMesas) || 0;
  await reporte.ejecutar('Mesas y tokens de QR', async () => {
    if (numMesas === 0) {
      reporte.fallo('Mesas configuradas', 'El restaurante no tiene "numMesas" definido (0 mesas).', 'Ve al Panel Maestro y escribe el número de mesas en el campo correspondiente — esto genera los tokens automáticamente.');
      return;
    }
    const privadoSnap = await db.collection('restaurantes').doc(restauranteId).collection('_privado').doc('mesaTokens').get();
    const mesaTokens = privadoSnap.exists ? (privadoSnap.data().mesaTokens || {}) : {};
    const faltantes = [];
    for (let i = 1; i <= numMesas; i++) {
      if (!mesaTokens[String(i)]) faltantes.push(i);
    }
    if (faltantes.length > 0) {
      reporte.fallo(
        'Mesas configuradas',
        `${numMesas} mesa(s) configuradas, pero faltan tokens para: ${faltantes.join(', ')}.`,
        'En el Panel Maestro, vuelve a escribir el número de mesas (o uno mayor y luego el correcto) para forzar que se generen los tokens faltantes.'
      );
    } else {
      reporte.ok('Mesas configuradas', `${numMesas} mesa(s), todas con su token.`);
    }
  });

  // ── QR: la URL de al menos una mesa responde ─────────────────────────
  if (numMesas > 0) {
    await reporte.ejecutar('QR apuntan a una URL válida', async () => {
      const privadoSnap = await db.collection('restaurantes').doc(restauranteId).collection('_privado').doc('mesaTokens').get();
      const mesaTokens = privadoSnap.exists ? (privadoSnap.data().mesaTokens || {}) : {};
      const token = mesaTokens['1'];
      if (!token) {
        reporte.aviso('QR apuntan a una URL válida', 'No se probó porque la mesa 1 no tiene token (ver el hallazgo de arriba).');
        return;
      }
      const url = `${baseUrl}/restaurante/${restauranteId}/menu/1?t=${token}`;
      const estado = await fetchEstado(url);
      if (estado === 200) {
        reporte.ok('QR apuntan a una URL válida', `Se probó la URL de la mesa 1 (${url}) — responde 200. Las demás mesas usan la misma ruta con distinto número y token.`);
      } else {
        reporte.fallo('QR apuntan a una URL válida', `La URL de la mesa 1 (${url}) respondió: ${estado}.`, 'Confirma que VITE_BASE_URL (o el dominio por defecto) coincida con el dominio real donde vive el sitio, y que el sitio esté desplegado.');
      }
    });
  }

  // ── Horarios ──────────────────────────────────────────────────────────
  if (tieneHorarioConfigurado(r.horarios)) {
    if (todosLosDiasCerrados(r.horarios)) {
      reporte.aviso(
        'Horarios configurados',
        'Los 7 días están marcados como "cerrado" — el restaurante nunca podrá recibir pedidos así.',
        '¿Es intencional (todavía no abren)? Si no, configura al menos un día en Admin → Horarios.'
      );
    } else {
      reporte.ok('Horarios configurados', 'Hay al menos un día con horario de apertura configurado.');
    }
  } else {
    reporte.fallo(
      'Horarios configurados',
      'El restaurante no tiene horarios configurados — la portada no podrá mostrar "abierto/cerrado" y el sistema nunca bloqueará pedidos fuera de horario.',
      'Configúralos en Admin → Horarios antes de entregar, o confírmale al dueño que el negocio acepta pedidos las 24 horas si de verdad es así.'
    );
  }

  // ── Admin y cocina asignados ──────────────────────────────────────────
  const admins = r.adminUids || [];
  const cocina = r.cocinaUids || [];
  if (admins.length > 0) {
    reporte.ok('Tiene admin asignado', `${admins.length} cuenta(s) con acceso de administrador.`);
  } else {
    reporte.fallo('Tiene admin asignado', 'No hay ningún UID en adminUids.', 'Desde el Panel Maestro, sección "Invitaciones", invita al dueño como admin (o agrega su UID directo si ya tiene cuenta).');
  }
  if (cocina.length > 0) {
    reporte.ok('Tiene cocina asignada', `${cocina.length} cuenta(s) con acceso de cocina.`);
  } else {
    reporte.aviso('Tiene cocina asignada', 'No hay ningún UID en cocinaUids — solo el admin (o el maestro) puede ver la pantalla de Cocina.', 'Si cocina va a usar su propio dispositivo/cuenta, invítala desde el Panel Maestro. Si el mismo admin va a atender cocina, esto puede ser intencional.');
  }

  // ── Impuestos razonables ──────────────────────────────────────────────
  const imp = r.impuestos || {};
  if (imp.itbisActivo) {
    const pct = Number(imp.itbisPorcentaje);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 30) {
      reporte.fallo('ITBIS razonable', `ITBIS activo con un porcentaje fuera de rango: ${imp.itbisPorcentaje}.`, 'Corrígelo en Admin → Impuestos. El ITBIS legal en República Dominicana es 18%.');
    } else if (pct !== 18) {
      reporte.aviso('ITBIS razonable', `ITBIS activo al ${pct}% (el legal en RD es 18%).`, 'Confirma con el dueño que el porcentaje distinto es intencional antes de entregar.');
    } else {
      reporte.ok('ITBIS razonable', 'Activo al 18% (el legal en RD).');
    }
  } else {
    reporte.ok('ITBIS', 'Desactivado (decisión del restaurante).');
  }
  if (imp.propinaActivo) {
    const pct = Number(imp.propinaPorcentaje);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 20) {
      reporte.fallo('Propina razonable', `Propina activa con un porcentaje fuera de rango: ${imp.propinaPorcentaje}.`, 'Corrígelo en Admin → Impuestos. La propina legal usual en RD es 10%.');
    } else if (pct !== 10) {
      reporte.aviso('Propina razonable', `Propina activa al ${pct}% (lo usual en RD es 10%).`, 'Confirma con el dueño que el porcentaje distinto es intencional.');
    } else {
      reporte.ok('Propina razonable', 'Activa al 10% (lo usual en RD).');
    }
  } else {
    reporte.ok('Propina', 'Desactivada (decisión del restaurante).');
  }

  // ── Portada y botones ─────────────────────────────────────────────────
  await reporte.ejecutar('Portada pública', async () => {
    const url = `${baseUrl}/restaurante/${restauranteId}`;
    const estado = await fetchEstado(url);
    if (estado !== 200) {
      reporte.fallo('La portada carga', `${url} respondió: ${estado}.`, 'Confirma que el sitio esté desplegado y que el ID del restaurante sea correcto.');
      return;
    }
    reporte.ok('La portada carga', `${url} responde 200.`);

    const botones = r.botones || [];
    const activos = botones.filter((b) => b.activo !== false);
    if (activos.length === 0) {
      reporte.aviso('Botones de la portada', 'No hay ningún botón activo (ni siquiera "Ver carta").', 'Agrega al menos el botón de la carta desde Admin → Portada, para que quien la visite pueda llegar al menú.');
      return;
    }
    const invalidos = activos.filter((b) => !botonValido(b.tipo, b.destino));
    if (invalidos.length > 0) {
      reporte.fallo(
        'Botones de la portada',
        `${invalidos.length} botón(es) activo(s) sin un destino válido: ${invalidos.map((b) => b.etiqueta || b.tipo).join(', ')}.`,
        'Complétalos o desactívalos desde Admin → Portada → Botones.'
      );
    } else {
      reporte.ok('Botones de la portada', `${activos.length} botón(es) activo(s), todos con destino válido.`);
    }
  });
}
