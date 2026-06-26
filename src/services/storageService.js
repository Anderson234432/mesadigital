import imageCompression from 'browser-image-compression';
import * as storageRepo from '../repositories/storageRepository';

const OPCIONES_COMPRESION = { maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true };

export async function subirImagenPlato(imagen) {
  if (imagen.size > 3 * 1024 * 1024) throw new Error('La imagen supera los 3MB.');
  const comprimida = await imageCompression(imagen, OPCIONES_COMPRESION);
  return storageRepo.subirArchivo(`platos/${Date.now()}_${imagen.name}`, comprimida);
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
