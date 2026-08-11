import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

// Metadatos de PRESENTACIÓN de categorías y subcategorías (imagen, orden) —
// mismo patrón que platosRepository.js. Qué categorías/subcategorías
// EXISTEN se sigue derivando de los platos (ver src/utils/menuCategorias.js);
// esta colección es puramente decorativa y puede no tener documento para
// una categoría con platos (en ese caso se muestra sin imagen, como hoy).
export const subscribeCategorias = (restauranteId, onChange, onError) =>
  onSnapshot(
    collection(db, 'restaurantes', restauranteId, 'categorias'),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

// merge:true — así actualizar solo `orden` nunca pisa `imagenUrl` ya
// guardada, y viceversa; también sirve para crear el documento la primera
// vez (no existe un "crear" separado, el slug ya es el id determinista).
export const guardarCategoria = (restauranteId, slug, datos) =>
  setDoc(doc(db, 'restaurantes', restauranteId, 'categorias', slug), datos, { merge: true });
