// Lógica pura de agrupación y navegación de categorías/subcategorías del
// menú — compartida por Menu.jsx (flujo de pedido) y Carta.jsx (solo
// lectura), que antes duplicaban esta lógica letra por letra. La única
// diferencia real entre ambos consumidores es si se ocultan los platos
// agotados (Menu sí, porque no se pueden pedir; Carta no, los muestra
// marcados) — se resuelve con el parámetro `ocultarAgotados`, todo lo demás
// es idéntico.
//
// Igual que antes de esta feature: la agrupación SIEMPRE usa el campo en
// español (`categoria`/`subcategoria`) como dato canónico — el campo *En
// solo cambia la etiqueta mostrada, nunca decide a qué grupo pertenece un
// plato. Así un plato sin traducción nunca "desaparece" de su grupo.
//
// `categoriasMeta` es el array crudo de restaurantes/{id}/categorias (ver
// categoriasService.js) — documentos puramente decorativos (imagen, orden).
// Si una categoría/subcategoría con platos no tiene documento ahí, se
// comporta exactamente como antes de esta feature: sin imagen, orden
// alfabético.

import { slugify, slugSubcategoria } from './slug';

// Sentinel para el grupo "Otros" (platos de una categoría con
// subcategorías que no tienen subcategoria propia) — nunca puede
// colisionar con un nombre real porque no es un string visible al dueño.
export const OTROS = Symbol('otros');

function ordenarPorMetaLuegoAlfabetico(items) {
  return [...items].sort((a, b) => {
    if (a.orden != null && b.orden != null) return a.orden - b.orden;
    if (a.orden != null) return -1;
    if (b.orden != null) return 1;
    return a.nombre.localeCompare(b.nombre);
  });
}

export function listarCategorias(platos, categoriasMeta = []) {
  const metaPorSlug = new Map(categoriasMeta.map((m) => [m.id, m]));
  const nombres = [...new Set(platos.map((p) => p.categoria).filter(Boolean))];
  return ordenarPorMetaLuegoAlfabetico(nombres.map((nombre) => {
    const meta = metaPorSlug.get(slugify(nombre));
    return { nombre, imagenUrl: meta?.imagenUrl || '', orden: meta?.orden ?? null };
  }));
}

export function categoriaTieneSubcategorias(platos, categoria) {
  return platos.some((p) => p.categoria === categoria && p.subcategoria?.trim());
}

// Devuelve [] si ninguna plato de la categoría tiene subcategoría — nada
// cambia para quien no use esta función. Si hay mezcla (algunos platos con
// subcategoría, otros sin ella), agrega un ítem sintético OTROS al final,
// sin imagen propia.
export function listarSubcategorias(platos, categoria, categoriasMeta = []) {
  const deLaCategoria = platos.filter((p) => p.categoria === categoria);
  const metaPorSlug = new Map(categoriasMeta.map((m) => [m.id, m]));
  const nombres = [...new Set(deLaCategoria.map((p) => p.subcategoria).filter((s) => s?.trim()))];
  if (nombres.length === 0) return [];
  const items = ordenarPorMetaLuegoAlfabetico(nombres.map((nombre) => {
    const meta = metaPorSlug.get(slugSubcategoria(categoria, nombre));
    return { nombre, imagenUrl: meta?.imagenUrl || '', orden: meta?.orden ?? null };
  }));
  if (deLaCategoria.some((p) => !p.subcategoria?.trim())) {
    items.push({ nombre: OTROS, imagenUrl: '', orden: null });
  }
  return items;
}

// Mapa clave(ES) → valorEn, para traducir etiquetas — mismo patrón que ya
// usaban Menu.jsx/Carta.jsx antes de esta feature (primer valor no vacío
// encontrado). El llamador decide el alcance (todos los platos para
// categorías, solo los de una categoría para sus subcategorías).
export function mapaEtiquetas(platos, campoEs, campoEn) {
  const map = {};
  platos.forEach((p) => {
    const clave = p[campoEs];
    const en = p[campoEn];
    if (clave && en?.trim() && !map[clave]) map[clave] = en;
  });
  return map;
}

// Platos del nivel hoja (3) para una categoría/subcategoría dadas.
// `subcategoriaActiva`: null (categoría sin subcategorías) | OTROS
// (bucket sintético) | string (subcategoría real).
export function filtrarPlatosDeVista(platos, categoria, subcategoriaActiva, ocultarAgotados) {
  return platos
    .filter((p) => p.categoria === categoria)
    .filter((p) => (ocultarAgotados ? p.disponible !== false : true))
    .filter((p) => {
      if (subcategoriaActiva === OTROS) return !p.subcategoria?.trim();
      if (subcategoriaActiva) return p.subcategoria === subcategoriaActiva;
      return true; // categoría sin subcategorías: todos sus platos
    })
    .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));
}

// Búsqueda plana — nombre, categoría y subcategoría, en ambos idiomas.
// Ignora la jerarquía de navegación por completo (igual que antes).
export function buscarPlatos(platos, query, ocultarAgotados) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return platos
    .filter((p) => (ocultarAgotados ? p.disponible !== false : true))
    .filter((p) =>
      p.nombre?.toLowerCase().includes(q) ||
      p.nombreEn?.toLowerCase().includes(q) ||
      p.categoria?.toLowerCase().includes(q) ||
      p.categoriaEn?.toLowerCase().includes(q) ||
      p.subcategoria?.toLowerCase().includes(q) ||
      p.subcategoriaEn?.toLowerCase().includes(q)
    )
    .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));
}
