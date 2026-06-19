import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';

function Menu() {
  const { restauranteId, numeroMesa } = useParams();
  const [platos, setPlatos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [restaurante, setRestaurante] = useState(null);
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "restaurantes", restauranteId, "platos"), (snapshot) => {
      const datos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setPlatos(datos);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
  const cargarRestaurante = async () => {
    const restauranteDoc = await getDoc(doc(db, 'restaurantes', restauranteId));
    if (restauranteDoc.exists()) setRestaurante(restauranteDoc.data());
  };
  cargarRestaurante();

  const unsubscribe = onSnapshot(collection(db, "restaurantes", restauranteId, "platos"), (snapshot) => {
    const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    setPlatos(datos);
  });

  return () => unsubscribe();
}, []);

  function agregarAlCarrito(plato) {
    setCarrito([...carrito, plato]);
  }

  const total = carrito.reduce((suma, item) => suma + item.precio, 0);

  async function enviarPedido() {
    if (carrito.length === 0) return;

    await addDoc(collection(db, "restaurantes", restauranteId, "pedidos"), {
      mesa: numeroMesa,
      items: carrito.map((p) => ({ nombre: p.nombre, precio: p.precio })),
      total: total,
      estado: 'pendiente',
      creadoEn: serverTimestamp(),
    });

    setCarrito([]);
    alert(`Pedido enviado desde Mesa ${numeroMesa}`);
  }

  return (
  <div className="min-h-screen bg-neutral-950 text-white font-serif">
    {/* Header */}
    <div className="relative h-48 flex items-end justify-center pb-6"
      style={{ background: 'linear-gradient(to bottom, #1a0a00, #0a0a0a)' }}>
      <div className="text-center">
        <p className="text-amber-400 text-sm tracking-widest uppercase">Bienvenido</p>
        <h1 className="text-3xl font-bold tracking-wide">{restaurante?.nombre || 'Menú'}</h1>
      </div>
    </div>

    {/* Platos */}
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      {platos.map((plato) => (
        <div key={plato.id}
          className="flex justify-between items-center border-b border-neutral-800 pb-4">
          <div>
            <p className="text-lg font-semibold">{plato.imagenUrl && (
  <img src={plato.imagenUrl} alt={plato.nombre}
    className="w-full h-40 object-cover mb-3" />
)}{plato.nombre}</p>
            <p className="text-neutral-400 text-sm">{plato.descripcion}</p>
            <p className="text-amber-400 mt-1">RD${plato.precio}</p>
          </div>
          <button
            onClick={() => agregarAlCarrito(plato)}
            className="ml-4 border border-amber-400 text-amber-400 px-3 py-1 text-sm hover:bg-amber-400 hover:text-black transition-colors">
            + Agregar
          </button>
        </div>
      ))}
    </div>

    {/* Carrito */}
    {carrito.length > 0 && (
      <div className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-neutral-800 p-4">
        <div className="max-w-lg mx-auto">
          <p className="text-sm text-neutral-400 mb-1">{carrito.length} ítem(s) en tu pedido</p>
          <div className="flex justify-between items-center">
            <p className="text-xl font-bold text-amber-400">RD${total}</p>
            <button
              onClick={enviarPedido}
              className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
              Enviar pedido
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}

export default Menu;