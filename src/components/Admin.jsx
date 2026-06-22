import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDoc,
} from "firebase/firestore";
import { useParams } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function Admin() {
  const { restauranteId } = useParams();
  const [platos, setPlatos] = useState([]);
  const [form, setForm] = useState({
    nombre: "",
    precio: "",
    categoria: "",
    descripcion: "",
    imagenUrl: "",
    disponible: true,
    TiempoMin: "",
  });
  const [editandoId, setEditandoId] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [tiempos, setTiempos] = useState({});
  const [tiemposForm, setTiemposForm] = useState({});

  useEffect(() => {
    const cargarRestaurante = async () => {
      const restauranteDoc = await getDoc(doc(db, 'restaurantes', restauranteId));
      if (restauranteDoc.exists()) {
        const t = restauranteDoc.data().tiempos || {};
        setTiempos(t);
        setTiemposForm(t);
      }
    };
    cargarRestaurante();

    const unsub = onSnapshot(collection(db, "restaurantes", restauranteId, "platos"), (snap) => {
      setPlatos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  async function cerrarSesion() {
    await signOut(auth);
  }

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  async function subirImagen() {
    if (!imagen) return null;
    const storageRef = ref(storage, `platos/${Date.now()}_${imagen.name}`);
    await uploadBytes(storageRef, imagen);
    const url = await getDownloadURL(storageRef);
    return url;
  }

  const guardar = async () => {
    const urlImagen = await subirImagen();
    const datos = {
      ...form,
      precio: Number(form.precio),
      imagenUrl: urlImagen || form.imagenUrl,
    };
    if (editandoId) {
      await updateDoc(doc(db, "restaurantes", restauranteId, "platos", editandoId), datos);
      setEditandoId(null);
    } else {
      await addDoc(collection(db, "restaurantes", restauranteId, "platos"), datos);
    }
    setForm({ nombre: "", precio: "", categoria: "", descripcion: "", imagenUrl: "", disponible: true });
    setImagen(null);
    setFileKey(k => k + 1);
  };

  const editar = (plato) => {
    setForm(plato);
    setEditandoId(plato.id);
  };

  const eliminar = async (id) => {
    await deleteDoc(doc(db, "restaurantes", restauranteId, "platos", id));
  };

  async function guardarTiempos() {
    await updateDoc(doc(db, 'restaurantes', restauranteId), { tiempos: tiemposForm });
    alert('Tiempos guardados');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">
      {/* Header */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center">
        <div>
          <p className="text-amber-400 text-xs tracking-widest uppercase">Panel de</p>
          <h1 className="text-2xl font-bold">Administración</h1>
        </div>
        <button onClick={cerrarSesion}
          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
          Cerrar sesión
        </button>
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
            <input name="tiempoMin" placeholder="Tiempo de preparación (min)" type="number" value={form.tiempoMin || ''} onChange={handleChange}
  className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
          <input name="descripcion" placeholder="Descripción" value={form.descripcion} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
          <input
            key={fileKey}
            type="file"
            accept="image/*"
            onChange={(e) => setImagen(e.target.files[0])}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400"
          />
          <input name="imagenUrl" placeholder="O pega una URL de imagen" value={form.imagenUrl} onChange={handleChange}
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
                <button onClick={() => updateDoc(doc(db, "restaurantes", restauranteId, "platos", p.id), { disponible: !p.disponible })}
                  className={`text-xs border px-3 py-1 transition-colors ${p.disponible !== false ? 'border-neutral-600 text-neutral-400 hover:border-red-400 hover:text-red-400' : 'border-amber-400 text-amber-400'}`}>
                  {p.disponible !== false ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => eliminar(p.id)}
                  className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Tiempos de espera */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Tiempos de espera</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-neutral-400 text-sm w-32">Bebidas (min)</label>
              <input
                type="number"
                value={tiemposForm.bebidas || ''}
                onChange={(e) => setTiemposForm({ ...tiemposForm, bebidas: Number(e.target.value) })}
                className="w-24 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>
          <button onClick={guardarTiempos}
            className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
            Guardar tiempos
          </button>
        </div>
      </div>
    </div>
  );
}