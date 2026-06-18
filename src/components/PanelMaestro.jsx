import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

function PanelMaestro() {
  const [restaurantes, setRestaurantes] = useState([]);
  const [nombre, setNombre] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'restaurantes'), (snapshot) => {
      const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRestaurantes(datos);
    });
    return () => unsubscribe();
  }, []);

  async function crearRestaurante() {
    if (!nombre) return;
    await addDoc(collection(db, 'restaurantes'), { nombre });
    setNombre('');
  }

  return (
    <div>
      <h1>Panel Maestro</h1>
      <input
        placeholder="Nombre del restaurante"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      <button onClick={crearRestaurante}>Crear restaurante</button>

      <h3>Restaurantes</h3>
      {restaurantes.map((r) => (
        <div key={r.id}>
          <strong>{r.nombre}</strong> — ID: {r.id}
        </div>
      ))}
    </div>
  );
}

export default PanelMaestro;