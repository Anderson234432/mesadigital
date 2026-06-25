import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import {
  collection, onSnapshot, doc, query, where, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useParams } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import {
  enviarPedido as enviarPedidoService,
  llamarMesero as llamarMeseroService,
} from '../services/pedidosService';

// Memoized plato card — only re-renders when its own props change,
// preventing full-list repaint on every carrito mutation.
const PlatoItem = memo(function PlatoItem({ plato, cantidad, onAgregar, onQuitar }) {
  return (
    <div className="border-b border-neutral-800 pb-4">
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
          {cantidad > 0 ? (
            <>
              <button
                onClick={() => onQuitar(plato.id)}
                className="border border-neutral-600 text-white w-7 h-7 flex items-center justify-center hover:border-red-400 hover:text-red-400 transition-colors">
                −
              </button>
              <span className="text-white w-4 text-center">{cantidad}</span>
              <button
                onClick={() => onAgregar(plato)}
                className="border border-amber-400 text-amber-400 w-7 h-7 flex items-center justify-center hover:bg-amber-400 hover:text-black transition-colors">
                +
              </button>
            </>
          ) : (
            <button
              onClick={() => onAgregar(plato)}
              className="border border-amber-400 text-amber-400 px-3 py-1 text-sm hover:bg-amber-400 hover:text-black transition-colors">
              + Agregar
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

function Menu() {
  const { restauranteId, numeroMesa } = useParams();

  // Session isolation: one session per tab, survives refreshes, clears on tab close.
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

  // Anonymous auth: each customer session gets a stable UID for mesa isolation.
  // If auth fails (e.g., anonymous auth not enabled), the app degrades gracefully
  // to the old mesa-based query — functionality is preserved, isolation is reduced.
  const [authReady, setAuthReady] = useState(false);
  const clienteUidRef = useRef(null);

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
  // Synchronous flood guard — set before any await so rapid taps in the same
  // event loop tick are rejected even before React re-renders.
  const envioRef = useRef(false);

  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  // Step 1: anonymous auth before subscribing to Firestore.
  useEffect(() => {
    signInAnonymously(auth)
      .then(cred => {
        clienteUidRef.current = cred.user.uid;
        if (montadoRef.current) setAuthReady(true);
      })
      .catch(e => {
        // Degrade gracefully: no mesa isolation but orders still work.
        console.warn('Auth anónima no disponible, continuando sin UID:', e.code);
        if (montadoRef.current) setAuthReady(true);
      });
  }, []);

  // ─── Memoized derived state ─────────────────────────────────────────────────

  const total = useMemo(
    () => carrito.reduce((suma, item) => suma + item.precio, 0),
    [carrito]
  );

  const carritoAgrupado = useMemo(
    () => carrito.reduce((acc, item) => {
      const existe = acc.find(i => i.id === item.id);
      if (existe) { existe.cantidad += 1; existe.subtotal += item.precio; }
      else acc.push({ ...item, cantidad: 1, subtotal: item.precio });
      return acc;
    }, []),
    [carrito]
  );

  const categorias = useMemo(
    () => [...new Set(platos.map(p => p.categoria))],
    [platos]
  );

  const platosFiltrados = useMemo(
    () => platos.filter(p => p.categoria === categoriaActiva && p.disponible !== false),
    [platos, categoriaActiva]
  );

  // ─── Stable callbacks for PlatoItem memo ───────────────────────────────────

  const agregarAlCarrito = useCallback((plato) => {
    setCarrito(prev => [...prev, {
      id: plato.id,
      nombre: plato.nombre,
      precio: plato.precio,
      categoria: plato.categoria,
      tiempoMin: plato.tiempoMin || 0,
    }]);
  }, []);

  const quitarDelCarrito = useCallback((platoId) => {
    setCarrito(prev => {
      const idx = [...prev].map(i => i.id).lastIndexOf(platoId);
      if (idx === -1) return prev;
      const n = [...prev];
      n.splice(idx, 1);
      return n;
    });
  }, []);

  // ─── Firebase subscriptions (after auth is ready) ──────────────────────────

  useEffect(() => {
    if (!authReady) return;

    // Restaurant doc — includes stats.mesasPendientes (single small document,
    // replaces the old global pending-orders query that ran on every client).
    const unsubRestaurante = onSnapshot(
      doc(db, 'restaurantes', restauranteId),
      (snap) => {
        if (!montadoRef.current || !snap.exists()) return;
        const data = snap.data();
        setRestaurante(data);
        setTiemposRestaurante(data.tiempos || {});
        setMesasPendientes(Math.max(0, data.stats?.mesasPendientes || 0));
      },
      (err) => console.error('Error cargando restaurante:', err)
    );

    const unsubPlatos = onSnapshot(
      collection(db, 'restaurantes', restauranteId, 'platos'),
      (snapshot) => {
        if (!montadoRef.current) return;
        setPlatos(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
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

      // If the customer is authenticated anonymously, query by their UID for isolation.
      // If auth failed (degraded mode), fall back to mesa-based query.
      const pedidosQuery = clienteUidRef.current
        ? query(
            collection(db, 'restaurantes', restauranteId, 'pedidos'),
            where('clienteUid', '==', clienteUidRef.current)
          )
        : query(
            collection(db, 'restaurantes', restauranteId, 'pedidos'),
            where('mesa', '==', numeroMesa)
          );

      subsRef.current.miMesa = onSnapshot(
        pedidosQuery,
        procesarPedidos,
        (err) => {
          console.error('Error en pedidos de mesa:', err);
          if (montadoRef.current) setTimeout(subscribe, 3000);
        }
      );
    }

    resubscribeRef.current = subscribe;
    subscribe();

    return () => {
      unsubRestaurante();
      unsubPlatos();
      if (subsRef.current.miMesa) subsRef.current.miMesa();
    };
  }, [authReady, restauranteId, numeroMesa]);

  // Re-subscribe on visibility change — critical for mobile tab switching.
  useEffect(() => {
    const handle = () => {
      if (document.visibilityState !== 'visible') return;
      if (resubscribeRef.current) resubscribeRef.current();
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(`carrito_${restauranteId}_${numeroMesa}`, JSON.stringify(carrito));
    } catch (e) {
      console.error('Error guardando carrito:', e);
    }
  }, [carrito, restauranteId, numeroMesa]);

  // ─── Order submission ───────────────────────────────────────────────────────

  const enviarPedido = useCallback(async () => {
    if (envioRef.current || carrito.length === 0) return;
    envioRef.current = true;
    setEnviando(true);
    setError('');

    // Compute time estimate before clearing cart
    const tieneBebidas = carrito.some(p => p.categoria?.toLowerCase() === 'bebidas');
    const tieneComida = carrito.some(p => p.categoria?.toLowerCase() !== 'bebidas');
    const tiempoBebida = tiemposRestaurante.bebidas || 5;
    const tiempoComida = tieneComida
      ? Math.max(...carrito.filter(p => p.categoria?.toLowerCase() !== 'bebidas').map(p => p.tiempoMin || 15)) * (mesasPendientes + 1)
      : null;
    let mensajeExito = '';
    if (tieneBebidas) mensajeExito += `🥤 Tu bebida tardará aprox ${tiempoBebida} min. `;
    if (tieneComida) mensajeExito += `🍽️ Tu comida tardará aprox ${tiempoComida} min.`;

    // Optimistic UI: clear cart and mark as pending immediately.
    // On failure the snapshot is restored (rollback).
    const carritoSnapshot = [...carrito];
    const notaSnapshot = nota;
    const totalSnapshot = total;
    setCarrito([]);
    setNota('');
    sessionStorage.removeItem(`carrito_${restauranteId}_${numeroMesa}`);
    setEstadoMesa('pendiente');

    try {
      await enviarPedidoService(restauranteId, {
        mesa: numeroMesa,
        carrito: carritoSnapshot,
        total: totalSnapshot,
        nota: notaSnapshot,
        clienteUid: clienteUidRef.current,
      });
      if (!montadoRef.current) return;
      setPedidoEnviado(mensajeExito || '¡Pedido enviado!');
      setTimeout(() => { if (montadoRef.current) setPedidoEnviado(''); }, 5000);
    } catch (e) {
      if (!montadoRef.current) return;
      // Rollback optimistic state
      setCarrito(carritoSnapshot);
      setNota(notaSnapshot);
      setEstadoMesa(null);
      const msg = e?.message?.includes('disponible')
        ? e.message
        : 'Error al enviar el pedido. Intenta de nuevo.';
      setError(msg);
      setTimeout(() => { if (montadoRef.current) setError(''); }, 6000);
    } finally {
      if (montadoRef.current) setEnviando(false);
      envioRef.current = false;
    }
  }, [carrito, nota, total, mesasPendientes, tiemposRestaurante, restauranteId, numeroMesa]);

  const llamarMesero = useCallback(async () => {
    if (llamandoMesero) return;
    setLlamandoMesero(true);
    try {
      await llamarMeseroService(restauranteId, numeroMesa, clienteUidRef.current);
      setTimeout(() => { if (montadoRef.current) setLlamandoMesero(false); }, 10000);
    } catch (e) {
      console.error('Error llamando mesero:', e);
      if (montadoRef.current) setLlamandoMesero(false);
    }
  }, [llamandoMesero, restauranteId, numeroMesa]);

  // Show blank screen while auth initializes (usually < 500ms).
  if (!authReady) return <div className="min-h-screen bg-neutral-950" />;

  // ─── View ───────────────────────────────────────────────────────────────────

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

      {/* Estado del pedido */}
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
            {platosFiltrados.map((plato) => {
              const cantidad = carritoAgrupado.find(i => i.id === plato.id)?.cantidad ?? 0;
              return (
                <PlatoItem
                  key={plato.id}
                  plato={plato}
                  cantidad={cantidad}
                  onAgregar={agregarAlCarrito}
                  onQuitar={quitarDelCarrito}
                />
              );
            })}
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
