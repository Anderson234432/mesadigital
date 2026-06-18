import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";
import { useParams } from 'react-router-dom'; 

export default function Admin() {
  const { restauranteId } = useParams();
  const [platos, setPlatos] = useState([]);
  const [form, setForm] = useState({
    nombre: "",
    precio: "",
    categoria: "",
    descripcion: "",
    imagenUrl: "",
  });
  const [editandoId, setEditandoId] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "restaurantes", restauranteId, "platos"), (snap) => {
      setPlatos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const guardar = async () => {
    const datos = { ...form, precio: Number(form.precio) };
    if (editandoId) {
      await updateDoc(doc(db, "restaurantes", restauranteId, "platos", editandoId), datos);
      setEditandoId(null);
    } else {
      await addDoc(collection(db, "restaurantes", restauranteId, "platos"), datos);
    }
    setForm({ nombre: "", precio: "", categoria: "", descripcion: "", imagenUrl: "" });
  };

  const editar = (plato) => {
    setForm(plato);
    setEditandoId(plato.id);
  };

  const eliminar = async (id) => {
    await deleteDoc(doc(db, "restaurantes", restauranteId, "platos", id));
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Panel de Admin</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 400 }}>
        <input name="nombre" placeholder="Nombre" value={form.nombre} onChange={handleChange} />
        <input name="precio" placeholder="Precio" type="number" value={form.precio} onChange={handleChange} />
        <input name="categoria" placeholder="Categoría" value={form.categoria} onChange={handleChange} />
        <input name="descripcion" placeholder="Descripción" value={form.descripcion} onChange={handleChange} />
        <input name="imagenUrl" placeholder="URL de imagen" value={form.imagenUrl} onChange={handleChange} />
        <button onClick={guardar}>{editandoId ? "Actualizar" : "Agregar"}</button>
        {editandoId && <button onClick={() => setEditandoId(null)}>Cancelar</button>}
      </div>

      <h3>Platos</h3>
      {platos.map((p) => (
        <div key={p.id} style={{ borderBottom: "1px solid #ccc", padding: "8px 0" }}>
          <strong>{p.nombre}</strong> — RD${p.precio} ({p.categoria})
          <br />
          <button onClick={() => editar(p)}>Editar</button>{" "}
          <button onClick={() => eliminar(p.id)}>Eliminar</button>
        </div>
      ))}
    </div>
  );
}