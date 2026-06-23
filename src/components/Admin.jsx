import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, getDoc, query, where, Timestamp,
} from "firebase/firestore";
import { useParams } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import imageCompression from 'browser-image-compression';

export default function Admin() {
  const { restauranteId } = useParams();
  const [platos, setPlatos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [form, setForm] = useState({
    nombre: "", precio: "", categoria: "",
    descripcion: "", imagenUrl: "", disponible: true, tiempoMin: "",
  });
  const [editandoId, setEditandoId] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [tiemposForm, setTiemposForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const formVacio = { nombre: "", precio: "", categoria: "", descripcion: "", imagenUrl: "", disponible: true, tiempoMin: "" };

  function mostrarMensaje(texto, tipo = 'ok') {
    setMensaje({ texto, tipo });
    setTimeout(() => setMensaje({ texto: '', tipo: '' }), 3500);
  }

  useEffect(() => {
    const cargarRestaurante = async () => {
      try {
        const snap = await getDoc(doc(db, 'restaurantes', restauranteId));
        if (snap.exists()) setTiemposForm(snap.data().tiempos || {});
      } catch (e) {
        console.error('Error cargando restaurante:', e);
      }
    };
    cargarRestaurante();

    const unsubPlatos = onSnapshot(
      collection(db, "restaurantes", restauranteId, "platos"),
      (snap) => setPlatos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Error en platos:', err)
    );

    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);

    const unsubPedidos = onSnapshot(
      query(
        collection(db, "restaurantes", restauranteId, "pedidos"),
        where("creadoEn", ">=", Timestamp.fromDate(inicioDia))
      ),
      (snap) => setPedidos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Error en pedidos:', err)
    );

    return () => {
      unsubPlatos();
      unsubPedidos();
    };
  }, [restauranteId]);

  async function cerrarSesion() {
    try { await signOut(auth); } catch (e) { console.error(e); }
  }

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function subirImagen() {
  if (!imagen) return null;
  if (imagen.size > 10 * 1024 * 1024) {
    mostrarMensaje('La imagen supera los 10MB.', 'error');
    return 'ERROR';
  }

  try {
    const opciones = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1024,
      useWebWorker: true,
    };
    const imagenComprimida = await imageCompression(imagen, opciones);
    const storageRef = ref(storage, `platos/${Date.now()}_${imagen.name}`);
    await uploadBytes(storageRef, imagenComprimida);
    return await getDownloadURL(storageRef);
  } catch (e) {
    console.error('Error subiendo imagen:', e);
    mostrarMensaje('Error al subir la imagen.', 'error');
    return 'ERROR';
  }
}
  const guardar = async () => {
    if (!form.nombre || !form.precio || !form.categoria) {
      mostrarMensaje('Nombre, precio y categoría son obligatorios.', 'error');
      return;
    }
    setGuardando(true);
    try {
      const urlImagen = await subirImagen();
      if (urlImagen === 'ERROR') { setGuardando(false); return; }

      const datos = {
        ...form,
        precio: Number(form.precio),
        tiempoMin: Number(form.tiempoMin) || 0,
        imagenUrl: urlImagen || form.imagenUrl,
      };

      if (editandoId) {
        await updateDoc(doc(db, "restaurantes", restauranteId, "platos", editandoId), datos);
        setEditandoId(null);
      } else {
        await addDoc(collection(db, "restaurantes", restauranteId, "platos"), datos);
      }

      setForm(formVacio);
      setImagen(null);
      setFileKey(k => k + 1);
      mostrarMensaje('Plato guardado correctamente.', 'ok');
    } catch (e) {
      console.error('Error guardando plato:', e);
      mostrarMensaje('Error al guardar. Intenta de nuevo.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  const editar = (plato) => { setForm(plato); setEditandoId(plato.id); };

  const eliminar = async (id) => {
    try { await deleteDoc(doc(db, "restaurantes", restauranteId, "platos", id)); }
    catch (e) { console.error('Error eliminando:', e); }
  };

  async function guardarTiempos() {
    try {
      await updateDoc(doc(db, 'restaurantes', restauranteId), { tiempos: tiemposForm });
      mostrarMensaje('Tiempos guardados.', 'ok');
    } catch (e) {
      mostrarMensaje('Error al guardar tiempos.', 'error');
    }
  }

  const hoy = new Date();
  const totalDia = pedidos.reduce((sum, p) => sum + (p.total || 0), 0);

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

      {/* Notificación */}
      {mensaje.texto && (
        <div className="fixed top-4 left-0 right-0 flex justify-center z-50">
          <div className={`px-6 py-3 font-bold text-sm text-center max-w-sm mx-4 ${mensaje.tipo === 'ok' ? 'bg-amber-400 text-black' : 'bg-red-500 text-white'}`}>
            {mensaje.texto}
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Formulario */}
        <div className="border border-neutral-800 p-6 space-y-3 mb-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">
            {editandoId ? 'Editar plato' : 'Nuevo plato'}
          </h2>
          <input name="nombre" placeholder="Nombre *" value={form.nombre} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
          <input name="precio" placeholder="Precio *" type="number" value={form.precio} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
          <input name="categoria" placeholder="Categoría *" value={form.categoria} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />

          {form.categoria?.toLowerCase() === 'bebidas' ? (
            <p className="text-xs text-amber-400 border border-amber-400 border-opacity-30 bg-amber-400 bg-opacity-5 px-3 py-2">
              Las bebidas no necesitan tiempo de preparación — su tiempo se configura en "Tiempos de espera".
            </p>
          ) : (
            <input name="tiempoMin" placeholder="Tiempo de preparación (min)" type="number" value={form.tiempoMin || ''} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
          )}

          <input name="descripcion" placeholder="Descripción" value={form.descripcion} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />
          <div>
            <input key={fileKey} type="file" accept="image/*"
              onChange={(e) => setImagen(e.target.files[0])}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400" />
            <p className="text-neutral-600 text-xs mt-1">Máximo 3MB</p>
          </div>
          <input name="imagenUrl" placeholder="O pega una URL de imagen" value={form.imagenUrl} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400" />

          <div className="flex gap-3 pt-2">
            <button onClick={guardar} disabled={guardando}
              className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {guardando ? 'Guardando...' : editandoId ? 'Actualizar' : 'Agregar'}
            </button>
            {editandoId && (
              <button onClick={() => { setEditandoId(null); setForm(formVacio); }}
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
          <div className="flex items-center gap-3">
            <label className="text-neutral-400 text-sm w-32">Bebidas (min)</label>
            <input type="number" value={tiemposForm.bebidas || ''}
              onChange={(e) => setTiemposForm({ ...tiemposForm, bebidas: Number(e.target.value) })}
              className="w-24 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
          </div>
          <button onClick={guardarTiempos}
            className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
            Guardar tiempos
          </button>
        </div>

        {/* Historial de ventas del día */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Ventas del día</h2>
          <p className="text-neutral-500 text-xs mb-6">
            {hoy.toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <div className="border border-neutral-700 p-4 mb-6">
            <p className="text-neutral-400 text-xs tracking-widest uppercase">Total del día</p>
            <p className="text-3xl font-bold text-amber-400 mt-1">RD${totalDia}</p>
            <p className="text-neutral-500 text-xs mt-1">{pedidos.length} pedido(s)</p>
          </div>
        
        
          <div className="space-y-4">
            {pedidos.length === 0 && (
              <p className="text-neutral-500 text-sm">No hay pedidos hoy todavía.</p>
            )}
            {[...pedidos]
              .sort((a, b) => (b.creadoEn?.toMillis() || 0) - (a.creadoEn?.toMillis() || 0))
              .map(p => (
                <div key={p.id} className="border-b border-neutral-800 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">Mesa {p.mesa}</p>
                      <p className="text-neutral-500 text-xs mb-2">
                        {p.creadoEn?.toDate().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <ul className="text-neutral-400 text-xs space-y-0.5">
                        {Object.values(
                          (p.items || []).reduce((acc, item) => {
                            if (!acc[item.nombre]) acc[item.nombre] = { ...item, cantidad: 0 };
                            acc[item.nombre].cantidad += 1;
                            return acc;
                          }, {})
                        ).map((item, i) => (
                          <li key={i}>{item.nombre} x{item.cantidad}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-400 font-bold">RD${p.total}</p>
                      <span className={`text-xs ${p.estado === 'archivado' ? 'text-neutral-500' : p.estado === 'listo' ? 'text-green-400' : 'text-amber-400'}`}>
                        {p.estado}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* Estadísticas — platos más pedidos */}
<div className="border border-neutral-800 p-6 mt-8">
  <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Platos más pedidos</h2>
  <p className="text-neutral-500 text-xs mb-6">Basado en los pedidos de hoy</p>

  {(() => {
    const conteo = {};
    pedidos.forEach(p => {
      (p.items || []).forEach(item => {
        if (!conteo[item.nombre]) conteo[item.nombre] = 0;
        conteo[item.nombre] += 1;
      });
    });

    const ranking = Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (ranking.length === 0) {
      return <p className="text-neutral-500 text-sm">No hay datos todavía.</p>;
    }

    const maximo = ranking[0][1];

    return (
      <div className="space-y-3">
        {ranking.map(([nombre, cantidad], i) => (
          <div key={nombre}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm text-white">
                <span className="text-amber-400 mr-2">#{i + 1}</span>{nombre}
              </span>
              <span className="text-neutral-400 text-xs">{cantidad} {cantidad === 1 ? 'vez' : 'veces'}</span>
            </div>
            <div className="w-full bg-neutral-800 h-1">
              <div
                className="bg-amber-400 h-1 transition-all"
                style={{ width: `${(cantidad / maximo) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  })()}
</div>
        </div>

      </div>
    </div>
  );
}