import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../firebase';

export async function subirArchivo(path, archivo) {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, archivo);
  return getDownloadURL(storageRef);
}

export const eliminarArchivoPorPath = (path) =>
  deleteObject(ref(storage, path));

export function extraerPathDeUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/\/o\/(.+?)(?:\?|$)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
