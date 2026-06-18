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
  <div className="min-h-screen bg-neutral-950 text-white font-serif">
    {/* Header */}
    <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4">
      <p className="text-amber-400 text-xs tracking-widest uppercase">Panel de</p>
      <h1 className="text-2xl font-bold">Administración</h1>
    </div>

    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Formulario */}
      <div className="border border-neutral-800 p-6 space-y-3 mb-8">
        <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">
          {editandoId ? 'Editar plato' : 'Nuevo plato'}
        </h2>
        <input name="nombre" placeholder="Nombre" value={form.nombre} onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
        <input name="precio" placeholder="Precio" type="number" value={form.precio} onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
        <input name="categoria" placeholder="Categoría" value={form.categoria} onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
        <input name="descripcion" placeholder="Descripción" value={form.descripcion} onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
        <input name="imagenUrl" placeholder="URL de imagen" value={form.imagenUrl} onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
        <div className="flex gap-3 pt-2">
          <button onClick={guardar}
            className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
            {editandoId ? 'Actualizar' : 'Agregar'}
          </button>
          {editandoId && (
            <button onClick={() => setEditandoId(null)}
              className="border border-neutral-600 text-neutral-400 px-6 py-2 hover:border-neutral-400 transition-colors">
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Lista de platos */}
      <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Platos</h2>
      <div className="space-y-3">
        {platos.map((p) => (
          <div key={p.id} className="flex justify-between items-center border-b border-neutral-800 pb-3">
            <div>
              <p className="font-semibold">{p.nombre}</p>
              <p className="text-neutral-400 text-sm">{p.categoria} — RD${p.precio}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => editar(p)}
                className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                Editar
              </button>
              <button onClick={() => eliminar(p.id)}
                className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
}