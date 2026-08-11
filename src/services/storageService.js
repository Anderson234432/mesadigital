import imageCompression from 'browser-image-compression';
import * as storageRepo from '../repositories/storageRepository';

const OPCIONES_COMPRESION = { maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true };

export async function subirImagenPlato(imagen, restauranteId) {
  if (imagen.size > 3 * 1024 * 1024) throw new Error('La imagen supera los 3MB.');
  const comprimida = await imageCompression(imagen, OPCIONES_COMPRESION);
  return storageRepo.subirArchivo(`restaurantes/${restauranteId}/platos/${Date.now()}_${imagen.name}`, comprimida);
}

// Logo y foto de portada de la marca del restaurante. Mismo patrón de
// compresión que las fotos de platos; solo cambia la ruta en Storage —
// storage.rules tiene una regla equivalente para restaurantes/{id}/marca/**
// (mismo admin-only-write que restaurantes/{id}/platos/**).
export async function subirImagenMarca(imagen, restauranteId, tipo) {
  if (imagen.size > 3 * 1024 * 1024) throw new Error('La imagen supera los 3MB.');
  const comprimida = await imageCompression(imagen, OPCIONES_COMPRESION);
  return storageRepo.subirArchivo(`restaurantes/${restauranteId}/marca/${tipo}_${Date.now()}_${imagen.name}`, comprimida);
}

// Fondo de tarjeta de categoría/subcategoría: se ve en una grilla de tiles
// (no a pantalla completa como marca.portadaUrl), y un menú puede tener
// varias — comprime más agresivo que platos/marca para no sumar peso
// innecesario a lo primero que carga un cliente con datos móviles.
const OPCIONES_COMPRESION_CATEGORIA = { maxSizeMB: 0.15, maxWidthOrHeight: 640, useWebWorker: true };

export async function subirImagenCategoria(imagen, restauranteId, slug) {
  if (imagen.size > 3 * 1024 * 1024) throw new Error('La imagen supera los 3MB.');
  const comprimida = await imageCompression(imagen, OPCIONES_COMPRESION_CATEGORIA);
  return storageRepo.subirArchivo(`restaurantes/${restauranteId}/categorias/${slug}_${Date.now()}_${imagen.name}`, comprimida);
}

export async function eliminarImagenPorUrl(url) {
  const path = storageRepo.extraerPathDeUrl(url);
  if (!path) return;
  try {
    await storageRepo.eliminarArchivoPorPath(path);
  } catch (e) {
    console.warn('No se pudo eliminar imagen de Storage:', e.code);
  }
}
