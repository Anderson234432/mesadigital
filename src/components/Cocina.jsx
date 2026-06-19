import { useState, useEffect } from 'react';
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

function Cocina() {
  async function cerrarSesion() {
  await signOut(auth);
}
  const { restauranteId } = useParams();
  const [pedidos, setPedidos] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "restaurantes", restauranteId, "pedidos"), (snapshot) => {
      const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPedidos(datos);
    });
    return () => unsubscribe();
  }, []);

  async function marcarListo(id) {
    await updateDoc(doc(db, "restaurantes", restauranteId, "pedidos", id), { estado: 'listo' });
  }

  return (
  <div className="min-h-screen bg-neutral-950 text-white font-serif">
    {/* Header */}
    <button onClick={cerrarSesion}
  className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
  Cerrar sesión
</button>

    {/* Pedidos */}
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      {pedidos.length === 0 && (
        <p className="text-neutral-500 text-center mt-20">Sin pedidos por el momento</p>
      )}
      {pedidos.map((pedido) => (
        <div key={pedido.id}
          className={`border p-4 ${pedido.estado === 'pendiente' ? 'border-amber-400' : 'border-neutral-700 opacity-50'}`}>
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-bold">Mesa {pedido.mesa}</h2>
            <span className={`text-xs tracking-widest uppercase px-2 py-1 ${pedido.estado === 'pendiente' ? 'bg-amber-400 text-black' : 'bg-neutral-700 text-neutral-400'}`}>
              {pedido.estado}
            </span>
          </div>
          <ul className="text-neutral-300 text-sm space-y-1 mb-3">
            {pedido.items.map((item, i) => (
              <li key={i}>{item.nombre} — RD${item.precio}</li>
            ))}
          </ul>
          <p className="text-amber-400 font-bold">Total: RD${pedido.total}</p>
          {pedido.estado === 'pendiente' && (
            <button
              onClick={() => marcarListo(pedido.id)}
              className="mt-3 border border-amber-400 text-amber-400 px-4 py-1 text-sm hover:bg-amber-400 hover:text-black transition-colors">
              Marcar como listo
            </button>
          )}
        </div>
      ))}
    </div>
  </div>
);
}

export default Cocina;