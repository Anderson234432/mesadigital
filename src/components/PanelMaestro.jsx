import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { QRCodeCanvas } from 'qrcode.react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

function PanelMaestro() {
  const [restaurantes, setRestaurantes] = useState([]);
  const [nombre, setNombre] = useState('');
  const [mesasPor, setMesasPor] = useState({});
  const [qrImprimiendo, setQrImprimiendo] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'restaurantes'), (snapshot) => {
      const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRestaurantes(datos);
    });
    return () => unsubscribe();
  }, []);

  async function cerrarSesion() {
    await signOut(auth);
  }

  async function crearRestaurante() {
    if (!nombre) return;
    await addDoc(collection(db, 'restaurantes'), { nombre });
    setNombre('');
  }
function imprimirQR(restauranteId, mesa, nombreRestaurante) {
  setQrImprimiendo({ restauranteId, mesa, nombreRestaurante });
}

function descargarQR() {
  const canvas = document.querySelector('#print-area canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `QR-Mesa-${qrImprimiendo.mesa}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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

        {/* Formulario nuevo restaurante */}
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

        {/* Lista de restaurantes */}
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

              {/* Input número de mesas */}
              <div className="mt-4 flex items-center gap-3">
              <input
                type="number"
                min="1"
                placeholder="Número de mesas"
                className="bg-neutral-900 border border-neutral-700 px-3 py-1 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 w-40 text-sm"
                onChange={(e) => {
                const valor = Number(e.target.value);
                if (valor >= 1) setMesasPor({ ...mesasPor, [r.id]: valor });
  }}
/>
                <span className="text-neutral-500 text-xs">mesas</span>
              </div>

              {/* QR por mesa */}
              <div className="flex flex-wrap gap-6 mt-4">
                {Array.from({ length: mesasPor[r.id] || 0 }, (_, i) => i + 1).map((mesa) => (
                  <div key={mesa} className="flex flex-col items-center gap-2">
                    <div data-qr={`${r.id}-${mesa}`} className="bg-white p-4">
                      <QRCodeCanvas
                        value={`https://mesadigital-pi.vercel.app/restaurante/${r.id}/menu/${mesa}`}
                        size={100}
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                    </div>
                    <p className="text-xs text-neutral-400">Mesa {mesa}</p>
                    <button
                      onClick={() => imprimirQR(r.id, mesa, r.nombre)}
                      className="text-xs border border-neutral-700 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                      Imprimir
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
{qrImprimiendo && (
  <div style={{ position: 'fixed', inset: 0, background: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>

    <button
      type="button"
      onClick={() => setQrImprimiendo(null)}
      style={{ position: 'absolute', top: 16, right: 16, background: '#333', color: 'white', border: 'none', padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
      ✕ Cerrar
    </button>

    <div id="print-area" style={{ padding: 48, textAlign: 'center', fontFamily: 'Georgia, serif' }}>
      <QRCodeCanvas
        value={`https://mesadigital-pi.vercel.app/restaurante/${qrImprimiendo.restauranteId}/menu/${qrImprimiendo.mesa}`}
        size={220}
        bgColor="#ffffff"
        fgColor="#000000"
      />
      <p style={{ marginTop: 16, fontSize: 13, color: '#666', letterSpacing: 3, textTransform: 'uppercase' }}>
        {qrImprimiendo.nombreRestaurante}
      </p>
      <p style={{ marginTop: 8, fontSize: 24, fontWeight: 'bold', color: '#000', letterSpacing: 4, textTransform: 'uppercase' }}>
        Mesa {qrImprimiendo.mesa}
      </p>
    </div>

    <button
      type="button"
      onClick={descargarQR}
      style={{ background: '#000', color: '#fff', border: 'none', padding: '12px 32px', fontSize: 14, cursor: 'pointer', letterSpacing: 2, textTransform: 'uppercase', marginTop: 8 }}>
      ⬇ Descargar QR
    </button>

  </div>
)}

    </div>
  );
}

export default PanelMaestro;