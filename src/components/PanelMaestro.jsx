import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { QRCodeSVG } from 'qrcode.react';

function PanelMaestro() {
  const [restaurantes, setRestaurantes] = useState([]);
  const [nombre, setNombre] = useState('');
  const [mesasPor, setMesasPor] = useState({});

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
  <div className="min-h-screen bg-neutral-950 text-white font-serif">
    {/* Header */}
    <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4">
      <p className="text-amber-400 text-xs tracking-widest uppercase">MesaDigital</p>
      <h1 className="text-2xl font-bold">Panel Maestro</h1>
    </div>

    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Formulario */}
      <div className="border border-neutral-800 p-6 mb-8">
        <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Nuevo restaurante</h2>
        <div className="flex gap-3">
          <input
            placeholder="Nombre del restaurante"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="flex-1 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
          />
          <button onClick={crearRestaurante}
            className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
            Crear
          </button>
        </div>
      </div>

      {/* Lista */}
      <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Restaurantes</h2>
      <div className="space-y-3">
        {restaurantes.map((r) => (
          <div key={r.id} className="border border-neutral-800 p-4">
            <p className="font-bold text-lg">{r.nombre}</p>
            <p className="text-neutral-500 text-xs mt-1">ID: {r.id}</p>
            <div className="flex gap-4 mt-3 text-xs text-amber-400">
              <a href={`/restaurante/${r.id}/admin`} className="hover:underline">Admin →</a>
              <a href={`/restaurante/${r.id}/cocina`} className="hover:underline">Cocina →</a>
            </div>

            {/* Generador de QR */}
            <div className="mt-4 flex items-center gap-3">
              <input
                type="number"
                placeholder="Número de mesas"
                className="bg-neutral-900 border border-neutral-700 px-3 py-1 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 w-40 text-sm"
                onChange={(e) => setMesasPor({ ...mesasPor, [r.id]: Number(e.target.value) })}
              />
              <span className="text-neutral-500 text-xs">mesas</span>
            </div>

            {/* QR por mesa */}
            <div className="flex flex-wrap gap-6 mt-4">
              {Array.from({ length: mesasPor[r.id] || 0 }, (_, i) => i + 1).map((mesa) => (
                <div key={mesa} className="flex flex-col items-center gap-2">
                  <QRCodeSVG
                    value={`https://mesadigital-pi.vercel.app/restaurante/${r.id}/mesa/${mesa}`}
                    size={100}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                  <p className="text-xs text-neutral-400">Mesa {mesa}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
}

export default
PanelMaestro;