import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

function Cocina() {
  const { restauranteId } = useParams();
  const [pedidos, setPedidos] = useState([]);
  const [cantidadAnterior, setCantidadAnterior] = useState(null);
  const audioContextRef = useRef(null);

  function reproducirSonido() {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const context = audioContextRef.current;
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(1, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.5);
    } catch (e) {
      console.error('Error reproduciendo sonido:', e);
    }
  }

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'restaurantes', restauranteId, 'pedidos'),
      (snapshot) => {
        const datos = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.estado !== 'archivado');
        setPedidos(datos);
      },
      (err) => console.error('Error en pedidos de cocina:', err)
    );
    return () => unsubscribe();
  }, [restauranteId]);

  useEffect(() => {
    if (cantidadAnterior !== null && pedidos.length > cantidadAnterior) {
      reproducirSonido();
    }
    setCantidadAnterior(pedidos.length);
  }, [pedidos]);

  async function cerrarSesion() {
    try { await signOut(auth); } catch (e) { console.error(e); }
  }

  async function marcarListoMesa(ids) {
    try {
      await Promise.all(ids.map(id =>
        updateDoc(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado: 'listo' })
      ));
    } catch (e) {
      console.error('Error marcando como listo:', e);
    }
  }

  async function archivarMesa(ids) {
    try {
      await Promise.all(ids.map(id =>
        updateDoc(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado: 'archivado' })
      ));
    } catch (e) {
      console.error('Error archivando mesa:', e);
    }
  }

  const mesasAgrupadas = pedidos.reduce((acc, pedido) => {
    const mesa = pedido.mesa;
    if (!acc[mesa]) {
      acc[mesa] = {
        mesa,
        rondas: [],
        total: 0,
        ids: [],
        estado: pedido.estado,
        primerPedido: pedido.creadoEn?.toMillis(),
        ultimoPedido: null,
      };
    }
    acc[mesa].rondas.push({ items: pedido.items || [], nota: pedido.nota || '' });
    acc[mesa].total += pedido.total || 0;
    acc[mesa].ids.push(pedido.id);
    if (!acc[mesa].ultimoPedido || (pedido.creadoEn?.toMillis() > acc[mesa].ultimoPedido)) {
      acc[mesa].ultimoPedido = pedido.creadoEn?.toMillis();
    }
    if (pedido.estado === 'pendiente') acc[mesa].estado = 'pendiente';
    return acc;
  }, {});

  const mesas = Object.values(mesasAgrupadas);

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">

      {/* Header */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center">
        <div>
          <p className="text-amber-400 text-xs tracking-widest uppercase">Panel de</p>
          <h1 className="text-2xl font-bold">Cocina</h1>
        </div>
        <button onClick={cerrarSesion}
          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
          Cerrar sesión
        </button>
      </div>

      {/* Pedidos */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {mesas.length === 0 && (
          <p className="text-neutral-500 text-center mt-20">Sin pedidos por el momento</p>
        )}
        {mesas.map((mesa) => (
          <div key={mesa.mesa}
            className={`border p-4 ${mesa.estado === 'pendiente' ? 'border-amber-400' : 'border-neutral-700 opacity-50'}`}>

            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Mesa {mesa.mesa}</h2>
              <span className={`text-xs tracking-widest uppercase px-2 py-1 ${mesa.estado === 'pendiente' ? 'bg-amber-400 text-black' : 'bg-neutral-700 text-neutral-400'}`}>
                {mesa.estado}
              </span>
            </div>

            {mesa.ids.length > 1 && mesa.estado === 'pendiente' &&
              mesa.ultimoPedido && mesa.primerPedido &&
              (mesa.ultimoPedido - mesa.primerPedido) > 15 * 60 * 1000 && (
              <p className="text-xs text-amber-400 mb-2 animate-pulse">⚡ Nueva orden de esta mesa</p>
            )}

            {mesa.rondas.map((ronda, i) => (
              <div key={i} className="mb-3 border-b border-neutral-800 pb-2">
                <ul className="text-neutral-300 text-sm space-y-1">
                  {Object.values(
                    ronda.items.reduce((acc, item) => {
                      if (!acc[item.nombre]) acc[item.nombre] = { ...item, cantidad: 0 };
                      acc[item.nombre].cantidad += 1;
                      return acc;
                    }, {})
                  ).map((item, j) => (
                    <li key={j}>{item.nombre} x{item.cantidad} — RD${item.precio * item.cantidad}</li>
                  ))}
                </ul>
                {ronda.nota && ronda.nota.trim() !== '' && (
                  <p className="text-neutral-400 text-xs italic mt-1">📝 {ronda.nota}</p>
                )}
              </div>
            ))}

            <p className="text-amber-400 font-bold">Total: RD${mesa.total}</p>
            <p className="text-neutral-500 text-xs mt-1">
              {mesa.primerPedido
                ? new Date(mesa.primerPedido).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
                : ''}
            </p>

            {mesa.estado === 'pendiente' && (
              <button onClick={() => marcarListoMesa(mesa.ids)}
                className="mt-3 border border-amber-400 text-amber-400 px-4 py-1 text-sm hover:bg-amber-400 hover:text-black transition-colors">
                Marcar mesa como lista
              </button>
            )}
            {mesa.estado === 'listo' && (
              <button onClick={() => archivarMesa(mesa.ids)}
                className="mt-3 border border-neutral-600 text-neutral-400 px-4 py-1 text-sm hover:border-red-400 hover:text-red-400 transition-colors">
                Archivar mesa
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Cocina;