import { getStorageModule } from '../firebase';

export async function subirArchivo(path, archivo) {
  const { ref, uploadBytes, getDownloadURL, storage } = await getStorageModule();
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, archivo);
  return getDownloadURL(storageRef);
}

export async function eliminarArchivoPorPath(path) {
  const { ref, deleteObject, storage } = await getStorageModule();
  return deleteObject(ref(storage, path));
}

export function extraerPathDeUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/\/o\/(.+?)(?:\?|$)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
