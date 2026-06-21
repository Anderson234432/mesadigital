import { useState, useEffect } from 'react';
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

function Cocina() {
  const { restauranteId } = useParams();
  const [pedidos, setPedidos] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'restaurantes', restauranteId, 'pedidos'), (snapshot) => {
      const datos = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.estado !== 'archivado');
      setPedidos(datos);
    });
    return () => unsubscribe();
  }, [restauranteId]);

  async function cerrarSesion() {
    await signOut(auth);
  }

  async function marcarListoMesa(ids) {
    await Promise.all(ids.map(id =>
      updateDoc(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado: 'listo' })
    ));
  }

  async function archivarMesa(ids) {
    await Promise.all(ids.map(id =>
      updateDoc(doc(db, 'restaurantes', restauranteId, 'pedidos', id), { estado: 'archivado' })
    ));
  }

  // Agrupa pedidos por mesa
  const mesasAgrupadas = pedidos.reduce((acc, pedido) => {
    const mesa = pedido.mesa;
    if (!acc[mesa]) acc[mesa] = { mesa, items: [], total: 0, ids: [], estado: pedido.estado, hora: pedido.creadoEn?.toMillis(), ultimoPedido: null, primerPedido: pedido.creadoEn?.toMillis() };
    pedido.items.forEach(item => acc[mesa].items.push(item));
    acc[mesa].total += pedido.total;
    acc[mesa].ids.push(pedido.id);
    if (!acc[mesa].ultimoPedido || pedido.creadoEn?.toMillis() > acc[mesa].ultimoPedido) {
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

            {/* Cabecera de la mesa */}
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-bold">Mesa {mesa.mesa}</h2>
              <span className={`text-xs tracking-widest uppercase px-2 py-1 ${mesa.estado === 'pendiente' ? 'bg-amber-400 text-black' : 'bg-neutral-700 text-neutral-400'}`}>
                {mesa.estado}
              </span>
            </div>

            {/* Alerta de nuevo pedido */}
            {mesa.ids.length > 1 && mesa.estado === 'pendiente' && 
  mesa.ultimoPedido && mesa.primerPedido &&
  (mesa.ultimoPedido - mesa.primerPedido) > 15 * 60 * 1000 && (
  <p className="text-xs text-amber-400 mb-2 animate-pulse">
    ⚡ Nueva orden de esta mesa
  </p>
)}
            {/* Items agrupados */}
            <ul className="text-neutral-300 text-sm space-y-1 mb-3">
              {Object.values(
                mesa.items.reduce((acc, item) => {
                  if (!acc[item.nombre]) acc[item.nombre] = { ...item, cantidad: 0 };
                  acc[item.nombre].cantidad += 1;
                  return acc;
                }, {})
              ).map((item, i) => (
                <li key={i}>{item.nombre} x{item.cantidad} — RD${item.precio * item.cantidad}</li>
              ))}
            </ul>

            {/* Total y hora */}
            <p className="text-amber-400 font-bold">Total: RD${mesa.total}</p>
            <p className="text-neutral-500 text-xs mt-1">
              {mesa.hora ? new Date(mesa.hora).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : ''}
            </p>

            {/* Botones */}
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