import * as platosRepo from '../repositories/platosRepository';
import { subirImagenPlato, eliminarImagenPorUrl } from './storageService';

export const subscribePlatos = (restauranteId, cb) =>
  platosRepo.subscribePlatos(
    restauranteId,
    cb,
    (err) => console.error('subscribePlatos:', err)
  );

export async function guardarPlato(restauranteId, form, imagen, editandoId) {
  let imagenUrl = form.imagenUrl || '';
  if (imagen) {
    imagenUrl = await subirImagenPlato(imagen);
  }

  const datos = {
    nombre: form.nombre,
    precio: Number(form.precio),
    categoria: form.categoria,
    descripcion: form.descripcion || '',
    imagenUrl,
    disponible: form.disponible !== false,
    tiempoMin: Number(form.tiempoMin) || 0,
    orden: form.orden !== '' ? Number(form.orden) : 0,
  };

  if (editandoId) {
    return platosRepo.actualizarPlato(restauranteId, editandoId, datos);
  }
  return platosRepo.crearPlato(restauranteId, datos);
}

export async function eliminarPlato(restauranteId, platoId, imagenUrl) {
  if (imagenUrl?.includes('firebasestorage.googleapis.com')) {
    await eliminarImagenPorUrl(imagenUrl);
  }
  return platosRepo.eliminarPlato(restauranteId, platoId);
}

export const toggleDisponible = (restauranteId, platoId, disponibleActual) =>
  platosRepo.actualizarPlato(restauranteId, platoId, { disponible: !disponibleActual });
