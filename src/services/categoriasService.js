import * as categoriasRepo from '../repositories/categoriasRepository';
import { subirImagenCategoria, eliminarImagenPorUrl } from './storageService';

export const subscribeCategorias = (restauranteId, cb) =>
  categoriasRepo.subscribeCategorias(
    restauranteId,
    cb,
    (err) => console.error('subscribeCategorias:', err)
  );

// datos = { nombre, nombreEn, tipo: 'categoria'|'subcategoria', categoriaSlug?, orden? }
// (ver Admin.jsx, sección Categorías, para cómo se arma este objeto).
export const guardarMeta = (restauranteId, slug, datos) =>
  categoriasRepo.guardarCategoria(restauranteId, slug, datos);

export async function subirImagen(restauranteId, slug, imagen, metaBase) {
  const imagenUrl = await subirImagenCategoria(imagen, restauranteId, slug);
  await categoriasRepo.guardarCategoria(restauranteId, slug, { ...metaBase, imagenUrl });
  return imagenUrl;
}

export async function quitarImagen(restauranteId, slug, imagenUrlActual, metaBase) {
  if (imagenUrlActual) await eliminarImagenPorUrl(imagenUrlActual);
  return categoriasRepo.guardarCategoria(restauranteId, slug, { ...metaBase, imagenUrl: '' });
}
