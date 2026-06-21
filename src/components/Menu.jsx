import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';

function Menu() {
  const { restauranteId, numeroMesa } = useParams();
  const [platos, setPlatos] = useState([]);
  const [carrito, setCarrito] = useState(() => {
    const guardado = sessionStorage.getItem(`carrito_${restauranteId}`);
    return guardado ? JSON.parse(guardado) : [];
  });
  const [restaurante, setRestaurante] = useState(null);
  const [bienvenida, setBienvenida] = useState(true);
  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
const [carritoAbierto, setCarritoAbierto] = useState(false);
const [nota, setNota] = useState('');
  useEffect(() => {
    const cargarRestaurante = async () => {
      const restauranteDoc = await getDoc(doc(db, 'restaurantes', restauranteId));
      if (restauranteDoc.exists()) setRestaurante(restauranteDoc.data());
    };
    cargarRestaurante();

    const unsubscribe = onSnapshot(collection(db, 'restaurantes', restauranteId, 'platos'), (snapshot) => {
      const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPlatos(datos);
    });

    return () => unsubscribe();
  }, [restauranteId]);

  useEffect(() => {
    sessionStorage.setItem(`carrito_${restauranteId}`, JSON.stringify(carrito));
  }, [carrito, restauranteId]);

  useEffect(() => {
    const timer = setTimeout(() => setBienvenida(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  function agregarAlCarrito(plato) {
    setCarrito(prev => [...prev, plato]);
  }

  const total = carrito.reduce((suma, item) => suma + item.precio, 0);

  async function enviarPedido() {
    if (carrito.length === 0) return;
    await addDoc(collection(db, 'restaurantes', restauranteId, 'pedidos'), {
      mesa: numeroMesa,
      items: carrito.map((p) => ({ nombre: p.nombre, precio: p.precio })),
      total: total,
      nota: nota,
      estado: 'pendiente',
      creadoEn: serverTimestamp(),
    });
    setCarrito([]);
    sessionStorage.removeItem(`carrito_${restauranteId}`);
    setPedidoEnviado(true);
    setNota('');
    setTimeout(() => setPedidoEnviado(false), 3000);
  }

  const categorias = [...new Set(platos.map((p) => p.categoria))];

const carritoAgrupado = carrito.reduce((acc, item) => {
  const existe = acc.find(i => i.id === item.id);
  if (existe) {
    existe.cantidad += 1;
    existe.subtotal += item.precio;
  } else {
    acc.push({ ...item, cantidad: 1, subtotal: item.precio });
  }
  return acc;
}, []);

if (bienvenida) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex flex-col items-center justify-center gap-4">
        <p className="text-amber-400 text-xs tracking-widest uppercase">Bienvenido a</p>
        <h1 className="text-4xl font-bold text-center">{restaurante?.nombre || 'Menú'}</h1>
        <p className="text-neutral-500 text-sm">Preparando tu menú...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">
      <div className="relative h-48 flex items-end justify-center pb-6"
        style={{ background: 'linear-gradient(to bottom, #1a0a00, #0a0a0a)' }}>
        <div className="text-center">
          <p className="text-amber-400 text-sm tracking-widest uppercase">Bienvenido</p>
          <h1 className="text-3xl font-bold tracking-wide">{restaurante?.nombre || 'Menú'}</h1>
        </div>
      </div>

      {!categoriaActiva ? (
        <div className="max-w-lg mx-auto px-4 py-8 space-y-3">
          {categorias.map((cat) => (
            <button key={cat} onClick={() => setCategoriaActiva(cat)}
              className="w-full border border-neutral-700 py-4 text-left px-6 text-lg font-semibold hover:border-amber-400 hover:text-amber-400 transition-colors capitalize">
              {cat}
            </button>
          ))}
        </div>
      ) : (
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setCategoriaActiva(null)}
              className="text-amber-400 text-sm hover:underline">
              ← Volver
            </button>
            <h2 className="text-amber-400 text-xs tracking-widest uppercase">
              Menú de {categoriaActiva}
            </h2>
          </div>
          <div className="space-y-4">
            {platos.filter((p) => p.categoria === categoriaActiva).map((plato) => (
              <div key={plato.id} className="border-b border-neutral-800 pb-4">
                {plato.imagenUrl && (
                  <img src={plato.imagenUrl} alt={plato.nombre}
                    className="w-full object-contain mb-3 max-h-64" />
                )}
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-lg font-semibold">{plato.nombre}</p>
                    <p className="text-neutral-400 text-sm">{plato.descripcion}</p>
                    <p className="text-amber-400 mt-1">RD${plato.precio}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
  {carritoAgrupado.find(i => i.id === plato.id) ? (
    <>
      <button onClick={() => setCarrito(prev => {
        const idx = [...prev].map(i => i.id).lastIndexOf(plato.id);
        const nuevo = [...prev];
        nuevo.splice(idx, 1);
        return nuevo;
      })}
        className="border border-neutral-600 text-white w-7 h-7 flex items-center justify-center hover:border-red-400 hover:text-red-400 transition-colors">
        −
      </button>
      <span className="text-white w-4 text-center">
        {carritoAgrupado.find(i => i.id === plato.id)?.cantidad}
      </span>
      <button onClick={() => agregarAlCarrito(plato)}
        className="border border-amber-400 text-amber-400 w-7 h-7 flex items-center justify-center hover:bg-amber-400 hover:text-black transition-colors">
        +
      </button>
    </>
  ) : (
    <button onClick={() => agregarAlCarrito(plato)}
      className="border border-amber-400 text-amber-400 px-3 py-1 text-sm hover:bg-amber-400 hover:text-black transition-colors">
      + Agregar
    </button>
  )}
</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pedidoEnviado && (
        <div className="fixed top-4 left-0 right-0 flex justify-center z-50">
          <div className="bg-amber-400 text-black px-6 py-3 font-bold text-sm">
            ✓ Pedido enviado — la cocina lo está preparando
          </div>
        </div>
      )}

      {carrito.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-neutral-800">
          <button onClick={() => setCarritoAbierto(!carritoAbierto)}
            className="w-full flex justify-between items-center px-4 py-3">
            <span className="text-sm text-neutral-400">{carrito.length} ítem(s)</span>
            <span className="text-amber-400 font-bold">RD${total} {carritoAbierto ? '▼' : '▲'}</span>
          </button>

          {carritoAbierto && (
            <div className="max-w-lg mx-auto px-4 pb-4">
              <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                {carritoAgrupado.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm text-neutral-300">
                    <span>{item.nombre} x{item.cantidad}</span>
                    <span>RD${item.subtotal}</span>
                  </div>
                ))}
              </div>
              <textarea
  placeholder="Nota para la cocina (opcional)..."
  value={nota}
  onChange={(e) => setNota(e.target.value)}
  className="w-full bg-neutral-800 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-sm resize-none mt-2"
  rows={2}
/>
              <div className="flex justify-between items-center border-t border-neutral-700 pt-3">
                <button onClick={() => {
                  setCarrito([]);
                  sessionStorage.removeItem(`carrito_${restauranteId}`);
                }} className="text-xs text-neutral-500 hover:text-red-400 transition-colors">
                  Cancelar
                </button>
                <button onClick={enviarPedido}
                  className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
                  Enviar pedido
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Menu;