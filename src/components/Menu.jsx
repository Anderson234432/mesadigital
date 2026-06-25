import { useState, useEffect, useRef } from 'react';
import {
  collection, onSnapshot, addDoc, serverTimestamp,
  getDoc, doc, query, where, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';

function Menu() {
  const { restauranteId, numeroMesa } = useParams();

  // Session isolation: persist session start across refreshes within same tab.
  // sessionStorage is per-tab and clears when the tab closes — new customer = new session.
  const sessionStart = useRef(null);
  if (sessionStart.current === null) {
    const key = `ss_${restauranteId}_${numeroMesa}`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      sessionStart.current = Timestamp.fromMillis(Number(stored));
    } else {
      const now = Timestamp.now();
      sessionStorage.setItem(key, String(now.toMillis()));
      sessionStart.current = now;
    }
  }

  const [restaurante, setRestaurante] = useState(null);
  const [platos, setPlatos] = useState([]);
  const [tiemposRestaurante, setTiemposRestaurante] = useState({});
  const [mesasPendientes, setMesasPendientes] = useState(0);
  const [estadoMesa, setEstadoMesa] = useState(null);
  const [pedidosMesa, setPedidosMesa] = useState([]);
  const [carrito, setCarrito] = useState(() => {
    try {
      const guardado = sessionStorage.getItem(`carrito_${restauranteId}_${numeroMesa}`);
      return guardado ? JSON.parse(guardado) : [];
    } catch {
      return [];
    }
  });
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [llamandoMesero, setLlamandoMesero] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [pedidoEnviado, setPedidoEnviado] = useState('');
  const [error, setError] = useState('');

  const montadoRef = useRef(true);
  const subsRef = useRef({});
  const resubscribeRef = useRef(null);

  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  useEffect(() => {
    const cargarRestaurante = async () => {
      try {
        const snap = await getDoc(doc(db, 'restaurantes', restauranteId));
        if (snap.exists()) {
          setRestaurante(snap.data());
          setTiemposRestaurante(snap.data().tiempos || {});
        }
      } catch (e) {
        console.error('Error cargando restaurante:', e);
      }
    };
    cargarRestaurante();

    const unsubPlatos = onSnapshot(
      collection(db, 'restaurantes', restauranteId, 'platos'),
      (snapshot) => {
        if (!montadoRef.current) return;
        setPlatos(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error('Error en platos:', err)
    );

    function procesarPedidos(snapshot) {
      if (!montadoRef.current) return;
      const sessionMs = sessionStart.current.toMillis();
      const todos = snapshot.docs
        .map(d => d.data())
        .filter(p =>
          p.estado !== 'archivado' &&
          (p.creadoEn?.toMillis() ?? 0) >= sessionMs
        );
      const conPedidos = todos.filter(p => p.tipo !== 'llamada');

      if (conPedidos.length === 0) setEstadoMesa(null);
      else if (conPedidos.some(p => p.estado === 'pendiente')) setEstadoMesa('pendiente');
      else setEstadoMesa('listo');

      setPedidosMesa(conPedidos);
    }

    function subscribe() {
      if (subsRef.current.miMesa) subsRef.current.miMesa();
      if (subsRef.current.conteo) subsRef.current.conteo();

      subsRef.current.miMesa = onSnapshot(
        query(
          collection(db, 'restaurantes', restauranteId, 'pedidos'),
          where('mesa', '==', numeroMesa)
        ),
        procesarPedidos,
        (err) => {
          console.error('Error en pedidos de mesa:', err);
          if (montadoRef.current) setTimeout(subscribe, 3000);
        }
      );

      subsRef.current.conteo = onSnapshot(
        query(
          collection(db, 'restaurantes', restauranteId, 'pedidos'),
          where('estado', '==', 'pendiente')
        ),
        (snapshot) => {
          if (!montadoRef.current) return;
          const mesas = new Set(snapshot.docs.map(d => d.data().mesa));
          setMesasPendientes(mesas.size);
        },
        (err) => {
          console.error('Error en conteo:', err);
          if (montadoRef.current) setTimeout(subscribe, 3000);
        }
      );
    }

    resubscribeRef.current = subscribe;
    subscribe();

    return () => {
      unsubPlatos();
      if (subsRef.current.miMesa) subsRef.current.miMesa();
      if (subsRef.current.conteo) subsRef.current.conteo();
    };
  }, [restauranteId, numeroMesa]);

  // Re-suscribir listeners al volver a la pestaña — crítico en móvil
  useEffect(() => {
    const handleVisibilidad = () => {
      if (document.visibilityState !== 'visible') return;
      if (resubscribeRef.current) resubscribeRef.current();
    };
    document.addEventListener('visibilitychange', handleVisibilidad);
    return () => document.removeEventListener('visibilitychange', handleVisibilidad);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(`carrito_${restauranteId}_${numeroMesa}`, JSON.stringify(carrito));
    } catch (e) {
      console.error('Error guardando carrito:', e);
    }
  }, [carrito, restauranteId, numeroMesa]);

  function agregarAlCarrito(plato) {
    setCarrito(prev => [...prev, {
      id: plato.id,
      nombre: plato.nombre,
      precio: plato.precio,
      categoria: plato.categoria,
      tiempoMin: plato.tiempoMin || 0,
    }]);
  }

  const total = carrito.reduce((suma, item) => suma + item.precio, 0);

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

  async function enviarPedido() {
    if (enviando || carrito.length === 0) return;
    setEnviando(true);
    setError('');

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 15000)
    );

    try {
      const tieneBebidas = carrito.some(p => p.categoria?.toLowerCase() === 'bebidas');
      const tieneComida = carrito.some(p => p.categoria?.toLowerCase() !== 'bebidas');
      const tiempoBebida = tiemposRestaurante.bebidas || 5;
      const tiempoComida = tieneComida
        ? Math.max(...carrito.filter(p => p.categoria?.toLowerCase() !== 'bebidas').map(p => p.tiempoMin || 15)) * (mesasPendientes + 1)
        : null;

      let mensaje = '';
      if (tieneBebidas) mensaje += `🥤 Tu bebida tardará aprox ${tiempoBebida} min. `;
      if (tieneComida) mensaje += `🍽️ Tu comida tardará aprox ${tiempoComida} min.`;

      await Promise.race([
        addDoc(collection(db, 'restaurantes', restauranteId, 'pedidos'), {
          mesa: numeroMesa,
          items: carrito.map((p) => ({ nombre: p.nombre, precio: p.precio, tiempoMin: p.tiempoMin || 0 })),
          total,
          estado: 'pendiente',
          nota: nota.slice(0, 500),
          creadoEn: serverTimestamp(),
        }),
        timeout,
      ]);

      if (!montadoRef.current) return;
      setCarrito([]);
      setNota('');
      sessionStorage.removeItem(`carrito_${restauranteId}_${numeroMesa}`);
      setPedidoEnviado(mensaje || '¡Pedido enviado!');
      setEstadoMesa('pendiente');
      setTimeout(() => { if (montadoRef.current) setPedidoEnviado(''); }, 5000);
    } catch (e) {
      if (!montadoRef.current) return;
      const msg = e.message === 'TIMEOUT'
        ? 'Conexión lenta. Espera unos segundos antes de intentar de nuevo.'
        : 'Error al enviar el pedido. Intenta de nuevo.';
      setError(msg);
      setTimeout(() => { if (montadoRef.current) setError(''); }, 6000);
    } finally {
      if (montadoRef.current) setEnviando(false);
    }
  }

  async function llamarMesero() {
    if (llamandoMesero) return;
    setLlamandoMesero(true);
    try {
      await addDoc(collection(db, 'restaurantes', restauranteId, 'pedidos'), {
        mesa: numeroMesa,
        items: [],
        total: 0,
        estado: 'pendiente',
        tipo: 'llamada',
        nota: '🔔 Mesa solicita atención',
        creadoEn: serverTimestamp(),
      });
      setTimeout(() => { if (montadoRef.current) setLlamandoMesero(false); }, 10000);
    } catch (e) {
      console.error('Error llamando mesero:', e);
      if (montadoRef.current) setLlamandoMesero(false);
    }
  }

  const categorias = [...new Set(platos.map((p) => p.categoria))];

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">

      {/* Header */}
      <div className="relative h-48 flex items-end justify-center pb-6"
        style={{ background: 'linear-gradient(to bottom, #1a0a00, #0a0a0a)' }}>
        <div className="text-center">
          <p className="text-amber-400 text-sm tracking-widest uppercase">Bienvenido</p>
          <h1 className="text-3xl font-bold tracking-wide">{restaurante?.nombre || ''}</h1>
        </div>
      </div>

      {/* Barra de estado del pedido */}
      {estadoMesa && (
        <div className={`sticky top-0 z-40 w-full py-3 text-center text-sm font-bold tracking-widest uppercase ${
          estadoMesa === 'listo' ? 'bg-green-500 text-white animate-pulse' : 'bg-amber-400 text-black'
        }`}>
          {estadoMesa === 'listo' ? '✓ Tu pedido está listo' : '🍳 Tu pedido está siendo preparado'}
        </div>
      )}

      {/* Historial de visita */}
      {pedidosMesa.length > 0 && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <button
            onClick={() => setHistorialAbierto(!historialAbierto)}
            className="w-full text-xs text-neutral-500 hover:text-amber-400 transition-colors text-left">
            {historialAbierto ? '▼' : '▶'} Ver mis pedidos
          </button>
          {historialAbierto && (
            <div className="border border-neutral-800 p-4 mt-2 mb-2 space-y-3">
              {pedidosMesa.map((p, i) => (
                <div key={i} className="border-b border-neutral-800 pb-2 last:border-0">
                  <div className="flex justify-between items-start">
                    <ul className="text-neutral-400 text-xs space-y-0.5">
                      {Object.values(
                        (p.items || []).reduce((acc, item) => {
                          if (!acc[item.nombre]) acc[item.nombre] = { ...item, cantidad: 0 };
                          acc[item.nombre].cantidad += 1;
                          return acc;
                        }, {})
                      ).map((item, j) => (
                        <li key={j}>{item.nombre} x{item.cantidad}</li>
                      ))}
                    </ul>
                    <p className="text-amber-400 text-xs font-bold ml-4">RD${p.total}</p>
                  </div>
                </div>
              ))}
              <div className="flex justify-between pt-1">
                <span className="text-xs text-neutral-500">Total acumulado</span>
                <span className="text-amber-400 font-bold text-sm">
                  RD${pedidosMesa.reduce((sum, p) => sum + (p.total || 0), 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Categorías o lista de platos */}
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
            {platos.filter((p) => p.categoria === categoriaActiva && p.disponible !== false).map((plato) => (
              <div key={plato.id} className="border-b border-neutral-800 pb-4">
                {plato.imagenUrl && (
                  <img
                    src={plato.imagenUrl}
                    alt={plato.nombre}
                    loading="lazy"
                    className="w-full object-contain mb-3 max-h-64"
                  />
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

      {/* Notificación pedido enviado */}
      {pedidoEnviado && (
        <div className="fixed top-4 left-0 right-0 flex justify-center z-50">
          <div className="bg-amber-400 text-black px-6 py-3 font-bold text-sm text-center max-w-sm mx-4">
            {pedidoEnviado}
          </div>
        </div>
      )}

      {/* Notificación error */}
      {error && (
        <div className="fixed top-4 left-0 right-0 flex justify-center z-50">
          <div className="bg-red-500 text-white px-6 py-3 font-bold text-sm text-center max-w-sm mx-4">
            {error}
          </div>
        </div>
      )}

      {/* Botón llamar al mesero */}
      {carrito.length === 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-neutral-800 px-4 py-3 flex justify-center">
          <button
            onClick={llamarMesero}
            disabled={llamandoMesero}
            className="border border-neutral-600 text-neutral-400 px-6 py-2 text-sm hover:border-amber-400 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {llamandoMesero ? '✓ Mesero notificado' : '🔔 Llamar al mesero'}
          </button>
        </div>
      )}

      {/* Carrito */}
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
                value={nota}
                onChange={(e) => setNota(e.target.value.slice(0, 500))}
                placeholder="Nota para cocina (opcional)..."
                rows={2}
                maxLength={500}
                className="w-full bg-neutral-800 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 text-sm focus:outline-none focus:border-amber-400 resize-none mb-3"
              />
              <div className="flex justify-between items-center border-t border-neutral-700 pt-3">
                <button onClick={() => {
                  setCarrito([]);
                  sessionStorage.removeItem(`carrito_${restauranteId}_${numeroMesa}`);
                }} className="text-xs text-neutral-500 hover:text-red-400 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={enviarPedido}
                  disabled={enviando}
                  className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {enviando ? 'Enviando...' : 'Enviar pedido'}
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
