import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { verificarAccesoCocina } from '../services/restaurantesService';
import { actualizarEstadoMesa, subscribePedidosHoy } from '../services/pedidosService';
import { subscribePlatos, toggleDisponible } from '../services/platosService';
import { logout, getUid } from '../services/authService';

function Cocina() {
  const { restauranteId } = useParams();

  // ─── Estado ───────────────────────────────────────────────
  const [acceso, setAcceso] = useState(null); // null=cargando, true=ok, false=denegado
  const [pedidos, setPedidos] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [disponibilidadAbierta, setDisponibilidadAbierta] = useState(false);
  const [busquedaPlatos, setBusquedaPlatos] = useState('');
  const [sonidoActivo, setSonidoActivo] = useState(false);
  const pedidosVistos = useRef(null);
  const [ahora, setAhora] = useState(Date.now());
  const audioContextRef = useRef(null);
  const unsubPedidosRef = useRef(null);
  const resubscribeRef = useRef(null);
  const retryTimerRef = useRef(null);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  // ─── Reloj para tiempo transcurrido ──────────────────────
  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(intervalo);
  }, []);

  // ─── Verificar acceso ────────────────────────────────────
  useEffect(() => {
    verificarAccesoCocina(restauranteId)
      .then(setAcceso)
      .catch((e) => { console.error('Error verificando acceso cocina:', e); setAcceso(false); });
  }, [restauranteId]);

  // ─── Platos (disponibilidad rápida) ──────────────────────
  useEffect(() => {
    if (acceso !== true) return;
    return subscribePlatos(restauranteId, setPlatos);
  }, [restauranteId, acceso]);

  // ─── Notificaciones del navegador ────────────────────────
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ─── Sonido ───────────────────────────────────────────────
  function activarSonido() {
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
      setSonidoActivo(true);
      tocarBip(audioContextRef.current, 0);
    } catch (e) {
      console.error('Error activando sonido:', e);
    }
  }

  function tocarBip(ctx, delay) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + 0.3);
  }

  function reproducirSonido(esLlamada = false) {
    if (!sonidoActivo) return;
    try {
      const ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'suspended') return;
      const bips = esLlamada ? 2 : 3;
      for (let i = 0; i < bips; i++) tocarBip(ctx, i * 0.35);
    } catch (e) {
      console.error('Error reproduciendo sonido:', e);
    }
  }

  // ─── Cargar pedidos del día (espera acceso confirmado) ──────
  useEffect(() => {
    if (acceso !== true) return;

    function subscribe() {
      if (unsubPedidosRef.current) unsubPedidosRef.current();
      unsubPedidosRef.current = subscribePedidosHoy(
        restauranteId,
        (todos) => { if (montadoRef.current) setPedidos(todos.filter((p) => p.estado !== 'archivado')); },
        (err) => { console.error('Error pedidos cocina:', err); if (montadoRef.current) retryTimerRef.current = setTimeout(subscribe, 3000); }
      );
    }

    resubscribeRef.current = subscribe;
    subscribe();

    return () => {
      clearTimeout(retryTimerRef.current);
      if (unsubPedidosRef.current) unsubPedidosRef.current();
    };
  }, [restauranteId, acceso]);

  // ─── Re-suscribir al volver a la pestaña (crítico en móvil) ──
  useEffect(() => {
    const handle = () => {
      if (document.visibilityState !== 'visible') return;
      if (resubscribeRef.current) resubscribeRef.current();
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, []);

  // ─── Detectar nuevos pedidos y notificar ─────────────────
  useEffect(() => {
    const nuevos = pedidosVistos.current === null
      ? []
      : pedidos.filter((p) => !pedidosVistos.current.has(p.id));

    if (nuevos.length > 0) {
      const tieneLlamada = nuevos.some((p) => p.tipo === 'llamada');
      const tienePedido = nuevos.some((p) => p.tipo !== 'llamada');
      if (tienePedido) reproducirSonido(false);
      else if (tieneLlamada) reproducirSonido(true);
      if ('Notification' in window && Notification.permission === 'granted') {
        nuevos.forEach((p) => {
          new Notification(p.tipo === 'llamada' ? '🔔 Llamada al mesero' : '🍽️ Nuevo pedido', {
            body: `Mesa ${p.mesa}`, silent: true,
          });
        });
      }
    }
    pedidosVistos.current = new Set(pedidos.map((p) => p.id));
  }, [pedidos]);

  // ─── Acciones ─────────────────────────────────────────────
  const cerrarSesion = () => logout().catch(console.error);

  const marcarListoMesa = (ids) =>
    actualizarEstadoMesa(restauranteId, ids, 'listo').catch(console.error);

  const archivarMesa = (ids) =>
    actualizarEstadoMesa(restauranteId, ids, 'archivado').catch(console.error);

  const descartarLlamada = (llamadaIds) =>
    actualizarEstadoMesa(restauranteId, llamadaIds, 'archivado').catch(console.error);

  // ─── Helper tiempo transcurrido ───────────────────────────
  function tiempoTranscurrido(timestamp) {
    if (!timestamp) return '';
    const minutos = Math.floor((ahora - timestamp) / 60000);
    if (minutos < 1) return 'Hace menos de 1 min';
    if (minutos === 1) return 'Hace 1 min';
    return `Hace ${minutos} min`;
  }

  // ─── Agrupar pedidos por mesa ─────────────────────────────
  const mesas = useMemo(() => {
    const agrupadas = pedidos.reduce((acc, pedido) => {
      const mesa = pedido.mesa;
      if (!acc[mesa]) {
        acc[mesa] = {
          mesa, rondas: [], llamadaIds: [], tieneLlamada: false,
          total: 0, ids: [], estado: pedido.estado,
          primerPedido: pedido.creadoEn?.toMillis(), ultimoPedido: null,
        };
      }
      acc[mesa].ids.push(pedido.id);
      if (pedido.tipo === 'llamada') {
        acc[mesa].tieneLlamada = true;
        acc[mesa].llamadaIds.push(pedido.id);
      } else {
        acc[mesa].rondas.push({ items: pedido.items || [], nota: pedido.nota || '' });
        acc[mesa].total += pedido.total || 0;
      }
      if (!acc[mesa].ultimoPedido || pedido.creadoEn?.toMillis() > acc[mesa].ultimoPedido) {
        acc[mesa].ultimoPedido = pedido.creadoEn?.toMillis();
      }
      if (pedido.estado === 'pendiente') acc[mesa].estado = 'pendiente';
      return acc;
    }, {});
    return Object.values(agrupadas);
  }, [pedidos]);

  // ─── Early returns ───────────────────────────────────────
  if (acceso === null) return <div className="min-h-screen bg-neutral-950" />;

  if (acceso === false) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-red-400 text-xs tracking-widest uppercase mb-2">Sin acceso</p>
          <h1 className="text-2xl font-bold mb-4">No tienes permiso</h1>
          <p className="text-neutral-500 text-sm mb-6">
            Tu cuenta no tiene acceso al panel de cocina de este restaurante.
          </p>
          <button onClick={cerrarSesion}
            className="text-xs border border-neutral-600 text-neutral-400 px-4 py-2 hover:border-red-400 hover:text-red-400 transition-colors">
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  // ─── Vista ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">

      {/* Header */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center">
        <div>
          <p className="text-amber-400 text-xs tracking-widest uppercase">Panel de</p>
          <h1 className="text-2xl font-bold">Cocina</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={sonidoActivo ? () => setSonidoActivo(false) : activarSonido}
            className={`text-xs border px-3 py-2 transition-colors min-h-[44px] ${
              sonidoActivo
                ? 'border-amber-400 text-amber-400 hover:border-neutral-600 hover:text-neutral-400'
                : 'border-neutral-600 text-neutral-500 hover:border-amber-400 hover:text-amber-400'
            }`}>
            {sonidoActivo ? '🔔 Sonido ON' : '🔕 Activar sonido'}
          </button>
          <button onClick={cerrarSesion}
            className="text-xs border border-neutral-600 text-neutral-400 px-3 py-2 hover:border-red-400 hover:text-red-400 transition-colors min-h-[44px]">
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Pedidos */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {mesas.length === 0 && (
          <p className="text-neutral-500 text-center mt-20">Sin pedidos por el momento</p>
        )}

        {mesas.map((mesa) => (
          <div key={mesa.mesa}
            className={`border p-4 ${mesa.estado === 'pendiente' ? 'border-amber-400' : 'border-neutral-700 opacity-50'}`}>

            {/* Alerta llamada al mesero */}
            {mesa.tieneLlamada && (
              <div className="flex justify-between items-center mb-3 px-3 py-2 border border-amber-400 border-opacity-30 bg-amber-400 bg-opacity-5">
                <p className="text-amber-400 text-sm font-bold">🔔 Mesa solicita atención</p>
                <button onClick={() => descartarLlamada(mesa.llamadaIds)}
                  className="text-xs border border-neutral-600 text-neutral-400 px-3 py-2 hover:border-green-400 hover:text-green-400 transition-colors min-h-[44px]">
                  ✓ Atendido
                </button>
              </div>
            )}

            {/* Header mesa */}
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Mesa {mesa.mesa}</h2>
              <span className={`text-xs tracking-widest uppercase px-2 py-1 ${mesa.estado === 'pendiente' ? 'bg-amber-400 text-black' : 'bg-neutral-700 text-neutral-400'}`}>
                {mesa.estado}
              </span>
            </div>

            {/* Alerta nueva ronda */}
            {mesa.rondas.length > 1 && mesa.estado === 'pendiente' &&
              mesa.ultimoPedido && mesa.primerPedido &&
              (mesa.ultimoPedido - mesa.primerPedido) > 15 * 60 * 1000 && (
              <p className="text-xs text-amber-400 mb-2 animate-pulse">⚡ Nueva orden de esta mesa</p>
            )}

            {/* Rondas de pedidos */}
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
                    <li key={j}>
                      {item.nombre} x{item.cantidad} — RD${item.precio * item.cantidad}
                      {item.nota && <span className="block text-amber-400 text-xs ml-2">↳ {item.nota}</span>}
                    </li>
                  ))}
                </ul>
                {ronda.nota && ronda.nota.trim() !== '' && (
                  <p className="text-neutral-400 text-xs italic mt-1">📝 {ronda.nota}</p>
                )}
              </div>
            ))}

            {/* Total y hora */}
            {mesa.rondas.length > 0 && (() => {
              const tiempoMax = Math.max(
                ...mesa.rondas.flatMap((r) => r.items.map((item) => item.tiempoMin || 0)), 0
              );
              const umbral = (tiempoMax + 5) * 60 * 1000;
              const demorado = mesa.estado === 'pendiente' && mesa.primerPedido && (ahora - mesa.primerPedido) > umbral;
              return (
                <>
                  <p className="text-amber-400 font-bold">Total: RD${mesa.total}</p>
                  <p className={`text-xs mt-1 ${demorado ? 'text-red-400 font-bold animate-pulse' : 'text-neutral-500'}`}>
                    {mesa.primerPedido
                      ? `${new Date(mesa.primerPedido).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })} · ${tiempoTranscurrido(mesa.primerPedido)}`
                      : ''}
                    {demorado ? ' ⚠️ Pedido demorado' : ''}
                  </p>
                </>
              );
            })()}

            {/* Botones */}
            {mesa.estado === 'pendiente' && mesa.rondas.length > 0 && (
              <button onClick={() => marcarListoMesa(mesa.ids)}
                className="mt-3 border border-amber-400 text-amber-400 px-4 py-3 text-sm hover:bg-amber-400 hover:text-black transition-colors min-h-[44px] w-full">
                Marcar mesa como lista
              </button>
            )}
            {mesa.estado === 'listo' && (
              <button onClick={() => archivarMesa(mesa.ids)}
                className="mt-3 border border-neutral-600 text-neutral-400 px-4 py-3 text-sm hover:border-red-400 hover:text-red-400 transition-colors min-h-[44px] w-full">
                Archivar mesa
              </button>
            )}
          </div>
        ))}

        {/* ── Disponibilidad rápida ── */}
        <div className="mt-8 border border-neutral-800">
          <button
            onClick={() => setDisponibilidadAbierta((v) => !v)}
            className="w-full flex justify-between items-center px-4 py-3 text-sm text-neutral-400 hover:text-white transition-colors">
            <span className="tracking-widest uppercase text-xs">Disponibilidad de platos</span>
            <span>{disponibilidadAbierta ? '▼' : '▶'}</span>
          </button>
          {disponibilidadAbierta && (
            <div className="border-t border-neutral-800 divide-y divide-neutral-800">
              <div className="px-4 py-3">
                <input
                  type="search"
                  value={busquedaPlatos}
                  onChange={(e) => setBusquedaPlatos(e.target.value)}
                  placeholder="Buscar plato..."
                  className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 text-base focus:outline-none focus:border-amber-400"
                />
              </div>
              {platos.length === 0 && (
                <p className="text-neutral-600 text-sm px-4 py-4">Sin platos cargados.</p>
              )}
              {[...platos]
                .filter((p) => {
                  const q = busquedaPlatos.trim().toLowerCase();
                  return !q || p.nombre?.toLowerCase().includes(q) || p.categoria?.toLowerCase().includes(q);
                })
                .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || (a.orden ?? 999) - (b.orden ?? 999))
                .map((p) => {
                  const disponible = p.disponible !== false;
                  return (
                    <div key={p.id} className="flex justify-between items-center px-4 py-3">
                      <div>
                        <p className={`text-sm font-semibold ${disponible ? 'text-white' : 'text-neutral-600 line-through'}`}>
                          {p.nombre}
                        </p>
                        <p className="text-neutral-600 text-xs capitalize">{p.categoria}</p>
                      </div>
                      <button
                        onClick={() => toggleDisponible(restauranteId, p.id, disponible)}
                        className={`text-xs border px-3 py-2 min-h-[44px] transition-colors ${
                          disponible
                            ? 'border-neutral-600 text-neutral-400 hover:border-red-400 hover:text-red-400'
                            : 'border-amber-400 text-amber-400 hover:bg-amber-400 hover:text-black'
                        }`}>
                        {disponible ? 'Agotado' : 'Disponible'}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* UID del usuario */}
        <div className="mt-12 border-t border-neutral-800 pt-6 pb-8 text-center">
          <p className="text-neutral-700 text-xs mb-2">Tu identificador de usuario</p>
          <button
            onClick={async () => { try { await navigator.clipboard.writeText(getUid() || ''); } catch {} }}
            className="text-neutral-600 text-xs font-mono hover:text-amber-400 transition-colors break-all">
            {getUid()}
          </button>
          <p className="text-neutral-700 text-xs mt-1">Toca para copiar</p>
        </div>

      </div>
    </div>
  );
}

export default Cocina;
