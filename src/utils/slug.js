// Normaliza texto a un identificador seguro para Firestore (minusculas, sin
// tildes, simbolos/espacios convertidos a guiones). Une cada categoria o
// subcategoria (strings libres en cada plato -- no hay coleccion propia) con
// sus metadatos opcionales en restaurantes/{id}/categorias/{slug} -- ver
// src/services/categoriasService.js. Deterministico: mismo texto siempre
// produce el mismo slug, sin importar mayusculas o tildes distintas.
const RANGO_DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

export function slugify(texto) {
  return (texto || '')
    .toString()
    .normalize('NFD')
    .replace(RANGO_DIACRITICOS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Slug compuesto para una subcategoria -- depende de su categoria padre para
// no colisionar con una subcategoria del mismo nombre en otra categoria
// (ej. "Otros" podria existir bajo Bebidas y bajo Comida a la vez).
export function slugSubcategoria(categoria, subcategoria) {
  return `${slugify(categoria)}__${slugify(subcategoria)}`;
}
