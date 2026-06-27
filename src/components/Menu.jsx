import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useParams } from 'react-router-dom';
import { loginAnonimo } from '../services/authService';
import { subscribeRestaurante } from '../services/restaurantesService';
import { subscribePlatos } from '../services/platosService';
import {
  enviarPedido as enviarPedidoService,
  llamarMesero as llamarMeseroService,
  subscribePedidosPorUid,
  parsearErrorPedido,
  reconectarFirestore,
  leerPedidosMesa,
} from '../services/pedidosService';

// Memoized plato card — only re-renders when its own props change
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
              <button onClick={() => onQuitar(plato.id)}
                className="border border-neutral-600 text-white w-11 h-11 flex items-center justify-center hover:border-red-400 hover:text-red-400 transition-colors">
                −
              </button>
              <span className="text-white w-4 text-center">{cantidad}</span>
              <button onClick={() => onAgregar(plato)}
                className="border border-amber-400 text-amber-400 w-11 h-11 flex items-center justify-center hover:bg-amber-400 hover:text-black transition-colors">
                +
              </button>
            </>
          ) : (
            <button onClick={() => onAgregar(plato)}
              className="border border-amber-400 text-amber-400 px-4 py-3 text-sm hover:bg-amber-400 hover:text-black transition-colors min-h-[44px]">
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
      sessionStart.current = Number(stored);
    } else {
      // 5s buffer: serverTimestamp puede estar ligeramente por delante del reloj del cliente
      const ts = Date.now() - 5000;
      sessionStorage.setItem(key, String(ts));
      sessionStart.current = ts;
    }
  }

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
  const [busqueda, setBusqueda] = useState('');
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [pedidoEnviado, setPedidoEnviado] = useState('');
  const [error, setError] = useState('');

  const montadoRef = useRef(true);
  const subsRef = useRef({});
  const resubscribeRef = useRef(null);
  const retryTimerRef = useRef(null);
  const pollTimerRef = useRef(null);
  const envioRef = useRef(false);

  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  // Autenticación anónima
  useEffect(() => {
    loginAnonimo()
      .then((cred) => {
        clienteUidRef.current = cred.user.uid;
        if (montadoRef.current) setAuthReady(true);
      })
      .catch((e) => {
        console.error('Auth anónima fallida, sin seguimiento de pedido:', e.code);
        if (montadoRef.current) setAuthReady(true);
      });
  }, []);

  // ─── Estado derivado ──────────────────────────────────────
  const total = useMemo(
    () => carrito.reduce((suma, item) => suma + item.precio, 0),
    [carrito]
  );

  const carritoAgrupado = useMemo(
    () => carrito.reduce((acc, item) => {
      const existe = acc.find((i) => i.id === item.id);
      if (existe) { existe.cantidad += 1; existe.subtotal += item.precio; }
      else acc.push({ ...item, cantidad: 1, subtotal: item.precio });
      return acc;
    }, []),
    [carrito]
  );

  const categorias = useMemo(
    () => [...new Set(platos.map((p) => p.categoria))].sort(),
    [platos]
  );

  const platosFiltrados = useMemo(
    () => platos
      .filter((p) => p.categoria === categoriaActiva && p.disponible !== false)
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999)),
    [platos, categoriaActiva]
  );

  const resultadosBusqueda = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return platos
      .filter((p) => p.disponible !== false && (
        p.nombre?.toLowerCase().includes(q) ||
        p.categoria?.toLowerCase().includes(q)
      ))
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));
  }, [platos, busqueda]);

  // ─── Callbacks estables para PlatoItem ───────────────────
  const agregarAlCarrito = useCallback((plato) => {
    setCarrito((prev) => [...prev, {
      id: plato.id, nombre: plato.nombre, precio: plato.precio,
      categoria: plato.categoria, tiempoMin: plato.tiempoMin || 0,
    }]);
  }, []);

  const quitarDelCarrito = useCallback((platoId) => {
    setCarrito((prev) => {
      const idx = [...prev].map((i) => i.id).lastIndexOf(platoId);
      if (idx === -1) return prev;
      const n = [...prev];
      n.splice(idx, 1);
      return n;
    });
  }, []);

  // ─── procesarPedidos (estable, usada también en polling) ──
  const procesarPedidos = useCallback((datos) => {
    if (!montadoRef.current) return;
    const sessionMs = sessionStart.current;
    const todos = datos.filter(
      (p) => p.estado !== 'archivado' && (p.creadoEn?.toMillis() ?? 0) >= sessionMs
    );
    const conPedidos = todos.filter((p) => p.tipo !== 'llamada');
    if (conPedidos.length === 0) setEstadoMesa(null);
    else if (conPedidos.some((p) => p.estado === 'pendiente')) setEstadoMesa('pendiente');
    else setEstadoMesa('listo');
    setPedidosMesa(conPedidos);
  }, []);

  // ─── Subscripciones Firebase ─────────────────────────────
  useEffect(() => {
    if (!authReady) return;

    const unsubRestaurante = subscribeRestaurante(restauranteId, (data) => {
      if (!montadoRef.current) return;
      setRestaurante(data);
      setTiemposRestaurante(data.tiempos || {});
      setMesasPendientes(Math.max(0, data.stats?.mesasPendientes || 0));
    });

    const unsubPlatos = subscribePlatos(restauranteId, (datos) => {
      if (!montadoRef.current) return;
      setPlatos(datos);
    });

    function subscribe() {
      if (subsRef.current.miMesa) subsRef.current.miMesa();

      const onError = (err) => {
        console.error('Error en pedidos de mesa:', err);
        if (montadoRef.current) retryTimerRef.current = setTimeout(subscribe, 3000);
      };

      // Sin UID (auth falló) no hay suscripción — Firestore denegaría cualquier query
      if (!clienteUidRef.current) return;
      subsRef.current.miMesa = subscribePedidosPorUid(
        restauranteId, clienteUidRef.current, procesarPedidos, onError
      );
    }

    resubscribeRef.current = subscribe;
    subscribe();

    // Polling cada 30s como red de seguridad cuando onSnapshot se queda mudo
    pollTimerRef.current = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      leerPedidosMesa(restauranteId, clienteUidRef.current)
        .then((datos) => { if (montadoRef.current) procesarPedidos(datos); })
        .catch(() => {});
    }, 30000);

    return () => {
      clearTimeout(retryTimerRef.current);
      clearInterval(pollTimerRef.current);
      unsubRestaurante();
      unsubPlatos();
      if (subsRef.current.miMesa) subsRef.current.miMesa();
    };
  }, [authReady, restauranteId, numeroMesa, procesarPedidos]);

  // Reconexión en móvil: visibilitychange + evento online
  useEffect(() => {
    async function reconectar() {
      try { await reconectarFirestore(); } catch {}
      if (resubscribeRef.current) resubscribeRef.current();
    }
    const alVolver = () => {
      if (document.visibilityState === 'visible') reconectar();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', reconectar);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', reconectar);
    };
  }, []);

  // Persistir carrito en sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(`carrito_${restauranteId}_${numeroMesa}`, JSON.stringify(carrito));
    } catch (e) {
      console.error('Error guardando carrito:', e);
    }
  }, [carrito, restauranteId, numeroMesa]);

  // ─── Envío de pedido ──────────────────────────────────────
  const enviarPedido = useCallback(async () => {
    if (envioRef.current || carrito.length === 0) return;
    envioRef.current = true;
    setEnviando(true);
    setError('');

    const tieneBebidas = carrito.some((p) => p.categoria?.toLowerCase() === 'bebidas');
    const tieneComida = carrito.some((p) => p.categoria?.toLowerCase() !== 'bebidas');
    const tiempoBebida = tiemposRestaurante.bebidas || 5;
    const tiempoComida = tieneComida
      ? Math.max(...carrito.filter((p) => p.categoria?.toLowerCase() !== 'bebidas').map((p) => p.tiempoMin || 15)) * (mesasPendientes + 1)
      : null;
    let mensajeExito = '';
    if (tieneBebidas) mensajeExito += `🥤 Tu bebida tardará aprox ${tiempoBebida} min. `;
    if (tieneComida) mensajeExito += `🍽️ Tu comida tardará aprox ${tiempoComida} min.`;

    // Optimistic UI — rollback en fallo
    const carritoSnapshot = [...carrito];
    const notaSnapshot = nota;
    const totalSnapshot = total;
    setCarrito([]);
    setNota('');
    sessionStorage.removeItem(`carrito_${restauranteId}_${numeroMesa}`);
    setEstadoMesa('pendiente');

    try {
      await enviarPedidoService(restauranteId, {
        mesa: numeroMesa, carrito: carritoSnapshot,
        total: totalSnapshot, nota: notaSnapshot,
        clienteUid: clienteUidRef.current,
      });
      if (!montadoRef.current) return;
      setPedidoEnviado(mensajeExito || '¡Pedido enviado!');
      setTimeout(() => { if (montadoRef.current) setPedidoEnviado(''); }, 5000);
    } catch (e) {
      if (!montadoRef.current) return;
      setCarrito(carritoSnapshot);
      setNota(notaSnapshot);
      setEstadoMesa(null);
      setError(parsearErrorPedido(e));
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

  if (!authReady) return <div className="min-h-screen bg-neutral-950" />;

  // ─── Vista ────────────────────────────────────────────────
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
          <button onClick={() => setHistorialAbierto(!historialAbierto)}
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

      {/* Buscador */}
      <div className="max-w-lg mx-auto px-4 pt-6 pb-2">
        <div className="relative">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setCategoriaActiva(null); }}
            placeholder="Buscar por nombre o categoría..."
            className="w-full bg-neutral-900 border border-neutral-700 px-4 py-3 text-white placeholder-neutral-500 text-base focus:outline-none focus:border-amber-400"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-lg leading-none">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Resultados de búsqueda / Categorías / Lista de platos */}
      {busqueda.trim() ? (
        <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
          {resultadosBusqueda.length === 0 ? (
            <p className="text-neutral-500 text-sm text-center py-8">Sin resultados para "{busqueda}"</p>
          ) : (
            resultadosBusqueda.map((plato) => {
              const cantidad = carritoAgrupado.find((i) => i.id === plato.id)?.cantidad ?? 0;
              return (
                <PlatoItem
                  key={plato.id}
                  plato={plato}
                  cantidad={cantidad}
                  onAgregar={agregarAlCarrito}
                  onQuitar={quitarDelCarrito}
                />
              );
            })
          )}
        </div>
      ) : !categoriaActiva ? (
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
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
              const cantidad = carritoAgrupado.find((i) => i.id === plato.id)?.cantidad ?? 0;
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
          <button onClick={llamarMesero} disabled={llamandoMesero}
            className="border border-neutral-600 text-neutral-400 px-6 py-3 text-sm hover:border-amber-400 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
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
                className="w-full bg-neutral-800 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 text-base focus:outline-none focus:border-amber-400 resize-none mb-3"
              />
              <div className="flex justify-between items-center border-t border-neutral-700 pt-3">
                <button onClick={() => {
                  setCarrito([]);
                  sessionStorage.removeItem(`carrito_${restauranteId}_${numeroMesa}`);
                }} className="text-xs text-neutral-500 hover:text-red-400 transition-colors">
                  Cancelar
                </button>
                <button onClick={enviarPedido} disabled={enviando}
                  className="bg-amber-400 text-black px-6 py-3 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
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
