import { useState, useEffect, useMemo } from "react";
import { useParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import { QRCodeCanvas } from 'qrcode.react';
import { verificarAccesoAdmin, guardarTiempos } from '../services/restaurantesService';
import { subscribePlatos, guardarPlato, eliminarPlato, toggleDisponible } from '../services/platosService';
import { subscribePedidosDia, actualizarEstadoMesa } from '../services/pedidosService';
import { logout, getUid } from '../services/authService';

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function Admin() {
  const { restauranteId } = useParams();

  // ─── Estado ───────────────────────────────────────────────
  const [acceso, setAcceso] = useState(null);
  const [nombreRestaurante, setNombreRestaurante] = useState('');
  const [platos, setPlatos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [fechaFiltro, setFechaFiltro] = useState(localDateStr);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState({
    nombre: '', precio: '', categoria: '',
    descripcion: '', imagenUrl: '', disponible: true, tiempoMin: '', orden: '',
  });
  const [editandoId, setEditandoId] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [tiemposForm, setTiemposForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  const [confirmarEliminarId, setConfirmarEliminarId] = useState(null);
  const [confirmarCerrarMesaId, setConfirmarCerrarMesaId] = useState(null);
  const [numMesasQR, setNumMesasQR] = useState('');
  const [qrImprimiendo, setQrImprimiendo] = useState(null);

  const formVacio = {
    nombre: '', precio: '', categoria: '',
    descripcion: '', imagenUrl: '', disponible: true, tiempoMin: '', orden: '',
  };

  // ─── Valores derivados ────────────────────────────────────
  const fechaSeleccionada = useMemo(() => {
    const [y, m, d] = fechaFiltro.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }, [fechaFiltro]);

  const esHoy = fechaFiltro === localDateStr();

  const pedidosReales = useMemo(
    () => pedidos.filter((p) => p.tipo !== 'llamada'),
    [pedidos]
  );

  const totalDia = useMemo(
    () => pedidosReales.reduce((sum, p) => sum + (p.total || 0), 0),
    [pedidosReales]
  );

  const ticketPromedio = useMemo(
    () => pedidosReales.length > 0 ? Math.round(totalDia / pedidosReales.length) : 0,
    [totalDia, pedidosReales]
  );

  const mesasActivas = useMemo(() => {
    const activos = pedidos.filter((p) => p.estado !== 'archivado' && p.tipo !== 'llamada');
    const agrupadas = activos.reduce((acc, p) => {
      const k = p.mesa;
      if (!acc[k]) acc[k] = { mesa: k, ids: [], total: 0, estado: 'listo' };
      acc[k].ids.push(p.id);
      acc[k].total += p.total || 0;
      if (p.estado === 'pendiente') acc[k].estado = 'pendiente';
      return acc;
    }, {});
    return Object.values(agrupadas)
      .sort((a, b) => String(a.mesa).localeCompare(String(b.mesa), undefined, { numeric: true }));
  }, [pedidos]);

  const platosOrdenados = useMemo(
    () => [...platos].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999)),
    [platos]
  );

  const platosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return platosOrdenados;
    const q = busqueda.toLowerCase();
    return platosOrdenados.filter(
      (p) => p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q)
    );
  }, [platosOrdenados, busqueda]);

  // ─── Helpers UI ───────────────────────────────────────────
  function mostrarMensaje(texto, tipo = 'ok') {
    setMensaje({ texto, tipo });
    setTimeout(() => setMensaje({ texto: '', tipo: '' }), 3500);
  }

  function generarCierrePDF() {
    const pdf = new jsPDF();
    const fechaStr = fechaSeleccionada.toLocaleDateString('es-DO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    pdf.setFontSize(20);
    pdf.text('Cierre de Caja', 105, 18, { align: 'center' });
    if (nombreRestaurante) {
      pdf.setFontSize(12);
      pdf.text(nombreRestaurante, 105, 27, { align: 'center' });
    }
    pdf.setFontSize(11);
    pdf.text(fechaStr, 105, nombreRestaurante ? 35 : 27, { align: 'center' });
    pdf.line(15, nombreRestaurante ? 40 : 32, 195, nombreRestaurante ? 40 : 32);

    pdf.setFontSize(13);
    const yBase = nombreRestaurante ? 50 : 42;
    pdf.text(`Total del día: RD$${totalDia}`, 15, yBase);
    pdf.text(`Pedidos: ${pedidosReales.length}  |  Promedio: RD$${ticketPromedio}`, 15, yBase + 8);
    pdf.line(15, yBase + 13, 195, yBase + 13);

    const conteo = {};
    pedidosReales.forEach((p) => {
      (p.items || []).forEach((item) => {
        if (!conteo[item.nombre]) conteo[item.nombre] = 0;
        conteo[item.nombre] += 1;
      });
    });
    const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const yRanking = yBase + 21;
    pdf.setFontSize(12);
    pdf.text('Platos más pedidos:', 15, yRanking);
    pdf.setFontSize(10);
    ranking.forEach(([nombre, cantidad], i) => {
      pdf.text(`${i + 1}. ${nombre} — ${cantidad} ${cantidad === 1 ? 'vez' : 'veces'}`, 20, yRanking + 8 + i * 8);
    });

    const offsetDetalle = yRanking + 12 + ranking.length * 8;
    pdf.line(15, offsetDetalle, 195, offsetDetalle);
    pdf.setFontSize(12);
    pdf.text('Detalle de pedidos:', 15, offsetDetalle + 8);
    pdf.setFontSize(9);

    let y = offsetDetalle + 16;
    [...pedidosReales]
      .sort((a, b) => (a.creadoEn?.toMillis() || 0) - (b.creadoEn?.toMillis() || 0))
      .forEach((p) => {
        if (y > 270) { pdf.addPage(); y = 15; }
        const hora = p.creadoEn?.toDate().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
        pdf.text(`Mesa ${p.mesa} — ${hora} — RD$${p.total}`, 15, y);
        y += 6;
        (p.items || []).forEach((item) => {
          if (y > 270) { pdf.addPage(); y = 15; }
          pdf.text(`   · ${item.nombre}`, 15, y);
          y += 5;
        });
        y += 2;
      });

    pdf.save(`cierre-${fechaFiltro}.pdf`);
  }

  // ─── Effect 1: acceso + platos ────────────────────────────
  useEffect(() => {
    verificarAccesoAdmin(restauranteId)
      .then(({ acceso: ok, nombre, tiempos }) => {
        setAcceso(ok);
        if (ok) {
          setNombreRestaurante(nombre);
          setTiemposForm(tiempos);
        }
      })
      .catch((e) => { console.error('Error verificando acceso admin:', e); setAcceso(false); });

    return subscribePlatos(restauranteId, setPlatos);
  }, [restauranteId]);

  // ─── Effect 2: pedidos del día ────────────────────────────
  useEffect(() => {
    if (acceso !== true) return;
    return subscribePedidosDia(restauranteId, fechaFiltro, setPedidos);
  }, [restauranteId, fechaFiltro, acceso]);

  // ─── Acciones ─────────────────────────────────────────────
  const cerrarSesion = () => logout().catch(console.error);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const guardar = async () => {
    if (!form.nombre || !form.precio || !form.categoria) {
      mostrarMensaje('Nombre, precio y categoría son obligatorios.', 'error');
      return;
    }
    setGuardando(true);
    try {
      await guardarPlato(restauranteId, form, imagen, editandoId);
      setEditandoId(null);
      setForm(formVacio);
      setImagen(null);
      setFileKey((k) => k + 1);
      mostrarMensaje('Plato guardado correctamente.', 'ok');
    } catch (e) {
      console.error('Error guardando plato:', e);
      mostrarMensaje(
        e.message === 'La imagen supera los 3MB.' ? e.message : 'Error al guardar. Intenta de nuevo.',
        'error'
      );
    } finally {
      setGuardando(false);
    }
  };

  const editar = (plato) => {
    setForm({ ...plato, orden: plato.orden ?? '' });
    setEditandoId(plato.id);
  };

  const eliminar = async (id) => {
    try {
      const plato = platos.find((p) => p.id === id);
      await eliminarPlato(restauranteId, id, plato?.imagenUrl);
      setConfirmarEliminarId(null);
    } catch (e) {
      console.error('Error eliminando:', e);
      mostrarMensaje('Error al eliminar el plato.', 'error');
    }
  };

  const handleGuardarTiempos = async () => {
    try {
      await guardarTiempos(restauranteId, tiemposForm);
      mostrarMensaje('Tiempos guardados.', 'ok');
    } catch {
      mostrarMensaje('Error al guardar tiempos.', 'error');
    }
  };

  const copiarUid = async () => {
    const uid = getUid();
    if (!uid) return;
    try {
      await navigator.clipboard.writeText(uid);
      mostrarMensaje('UID copiado al portapapeles.', 'ok');
    } catch {
      mostrarMensaje(`UID: ${uid}`, 'ok');
    }
  };

  const archivarMesaAdmin = (ids) =>
    actualizarEstadoMesa(restauranteId, ids, 'archivado')
      .catch(() => mostrarMensaje('Error al cerrar la mesa.', 'error'));

  const marcarListaMesaAdmin = (ids) =>
    actualizarEstadoMesa(restauranteId, ids, 'listo')
      .catch(() => mostrarMensaje('Error al marcar la mesa.', 'error'));

  // ─── Early returns ────────────────────────────────────────
  if (acceso === null) return <div className="min-h-screen bg-neutral-950" />;

  if (acceso === false) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-red-400 text-xs tracking-widest uppercase mb-2">Sin acceso</p>
          <h1 className="text-2xl font-bold mb-4">No tienes permiso</h1>
          <p className="text-neutral-500 text-sm mb-6">
            Tu cuenta no tiene acceso al panel de administración de este restaurante.
          </p>
          <div className="space-y-3">
            <a href={`/restaurante/${restauranteId}/cocina`}
              className="block text-sm border border-amber-400 text-amber-400 px-6 py-2 hover:bg-amber-400 hover:text-black transition-colors">
              Ir al panel de cocina
            </a>
            <button onClick={cerrarSesion}
              className="block w-full text-xs border border-neutral-600 text-neutral-400 px-4 py-2 hover:border-red-400 hover:text-red-400 transition-colors">
              Cerrar sesión
            </button>
          </div>
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
          <h1 className="text-2xl font-bold">Administración</h1>
          {nombreRestaurante && (
            <p className="text-neutral-500 text-xs mt-0.5">{nombreRestaurante}</p>
          )}
        </div>
        <button onClick={cerrarSesion}
          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
          Cerrar sesión
        </button>
      </div>

      {/* Notificación */}
      {mensaje.texto && (
        <div className="fixed top-4 left-0 right-0 flex justify-center z-50">
          <div className={`px-6 py-3 font-bold text-sm text-center max-w-sm mx-4 ${mensaje.tipo === 'ok' ? 'bg-amber-400 text-black' : 'bg-red-500 text-white'}`}>
            {mensaje.texto}
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-6">

        {/* ── Formulario de plato ── */}
        <div className="border border-neutral-800 p-6 space-y-3 mb-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">
            {editandoId ? 'Editar plato' : 'Nuevo plato'}
          </h2>
          <input name="nombre" placeholder="Nombre *" value={form.nombre} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <input name="precio" placeholder="Precio *" type="number" value={form.precio} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <input name="categoria" placeholder="Categoría *" value={form.categoria} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <input name="orden" placeholder="Orden de aparición en menú (1, 2, 3…)" type="number" value={form.orden} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />

          {form.categoria?.toLowerCase() === 'bebidas' ? (
            <p className="text-xs text-amber-400 border border-amber-400 border-opacity-30 bg-amber-400 bg-opacity-5 px-3 py-2">
              Las bebidas no necesitan tiempo de preparación — su tiempo se configura en "Tiempos de espera".
            </p>
          ) : (
            <input name="tiempoMin" placeholder="Tiempo de preparación (min)" type="number" value={form.tiempoMin || ''} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          )}

          <input name="descripcion" placeholder="Descripción" value={form.descripcion} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <div>
            <input key={fileKey} type="file" accept="image/*"
              onChange={(e) => setImagen(e.target.files[0])}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400 text-base" />
            <p className="text-neutral-600 text-xs mt-1">Máximo 3MB</p>
          </div>
          <input name="imagenUrl" placeholder="O pega una URL de imagen" value={form.imagenUrl} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />

          <div className="flex gap-3 pt-2">
            <button onClick={guardar} disabled={guardando}
              className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {guardando ? 'Guardando...' : editandoId ? 'Actualizar' : 'Agregar'}
            </button>
            {editandoId && (
              <button onClick={() => { setEditandoId(null); setForm(formVacio); }}
                className="border border-neutral-600 text-neutral-400 px-6 py-2 hover:border-neutral-400 transition-colors">
                Cancelar
              </button>
            )}
          </div>
        </div>

        {/* ── Lista de platos ── */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase">
            Platos ({platos.length})
          </h2>
          <input
            type="text"
            placeholder="Buscar nombre o categoría…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 px-3 py-1 text-white placeholder-neutral-500 text-base focus:outline-none focus:border-amber-400 w-44"
          />
        </div>
        <div className="space-y-3">
          {platosFiltrados.map((p) => (
            <div key={p.id} className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <div>
                <p className="font-semibold">{p.nombre}</p>
                <p className="text-neutral-400 text-sm">{p.categoria} — RD${p.precio}</p>
                {p.orden !== undefined && p.orden !== '' &&
                  <p className="text-neutral-600 text-xs">Orden: {p.orden}</p>}
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={() => editar(p)}
                  className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                  Editar
                </button>
                <button
                  onClick={() => toggleDisponible(restauranteId, p.id, p.disponible !== false)}
                  className={`text-xs border px-3 py-1 transition-colors ${p.disponible !== false
                    ? 'border-neutral-600 text-neutral-400 hover:border-red-400 hover:text-red-400'
                    : 'border-amber-400 text-amber-400'}`}>
                  {p.disponible !== false ? 'Desactivar' : 'Activar'}
                </button>
                {confirmarEliminarId === p.id ? (
                  <>
                    <button onClick={() => eliminar(p.id)}
                      className="text-xs border border-red-400 text-red-400 px-3 py-1 transition-colors">
                      ¿Confirmar?
                    </button>
                    <button onClick={() => setConfirmarEliminarId(null)}
                      className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 transition-colors">
                      No
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmarEliminarId(p.id)}
                    className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          ))}
          {platosFiltrados.length === 0 && busqueda && (
            <p className="text-neutral-500 text-sm">Sin resultados para "{busqueda}".</p>
          )}
        </div>

        {/* ── Tiempos de espera ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Tiempos de espera</h2>
          <div className="flex items-center gap-3">
            <label className="text-neutral-400 text-sm w-32">Bebidas (min)</label>
            <input type="number" value={tiemposForm.bebidas || ''}
              onChange={(e) => setTiemposForm({ ...tiemposForm, bebidas: Number(e.target.value) })}
              className="w-24 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-base" />
          </div>
          <button onClick={handleGuardarTiempos}
            className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
            Guardar tiempos
          </button>
        </div>

        {/* ── Mesas activas ── */}
        {mesasActivas.length > 0 && (
          <div className="border border-neutral-800 p-6 mt-8">
            <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Mesas activas</h2>
            <p className="text-neutral-500 text-xs mb-6">
              {esHoy ? 'Pedidos en curso — puedes cerrar una mesa manualmente' : 'Mesas sin cerrar de esta fecha'}
            </p>
            <div className="space-y-4">
              {mesasActivas.map((mesa) => (
                <div key={mesa.mesa} className="border border-neutral-800 p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <p className="font-semibold">Mesa {mesa.mesa}</p>
                      <p className="text-amber-400 font-bold text-sm">RD${mesa.total}</p>
                    </div>
                    <span className={`text-xs tracking-widest uppercase px-2 py-1 ${mesa.estado === 'pendiente' ? 'bg-amber-400 text-black' : 'bg-neutral-700 text-green-400'}`}>
                      {mesa.estado}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {mesa.estado === 'pendiente' && (
                      <button onClick={() => marcarListaMesaAdmin(mesa.ids)}
                        className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                        Marcar lista
                      </button>
                    )}
                    {confirmarCerrarMesaId === mesa.mesa ? (
                      <>
                        <button
                          onClick={() => { archivarMesaAdmin(mesa.ids); setConfirmarCerrarMesaId(null); }}
                          className="text-xs border border-red-400 text-red-400 px-3 py-1 transition-colors">
                          ¿Confirmar cierre?
                        </button>
                        <button onClick={() => setConfirmarCerrarMesaId(null)}
                          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 transition-colors">
                          No
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmarCerrarMesaId(mesa.mesa)}
                        className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
                        Cerrar mesa
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Ventas ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-amber-400 text-xs tracking-widest uppercase">Ventas</h2>
            {!esHoy && (
              <button onClick={() => setFechaFiltro(localDateStr())}
                className="text-xs text-amber-400 hover:underline">
                Volver a hoy
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mt-3 mb-4">
            <input
              type="date"
              value={fechaFiltro}
              max={localDateStr()}
              onChange={(e) => { if (e.target.value) setFechaFiltro(e.target.value); }}
              className="bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-base"
            />
          </div>
          <p className="text-neutral-500 text-xs mb-6">
            {fechaSeleccionada.toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="border border-neutral-700 p-4">
              <p className="text-neutral-400 text-xs tracking-widest uppercase">Total</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">RD${totalDia}</p>
            </div>
            <div className="border border-neutral-700 p-4">
              <p className="text-neutral-400 text-xs tracking-widest uppercase">Pedidos</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{pedidosReales.length}</p>
            </div>
            <div className="border border-neutral-700 p-4">
              <p className="text-neutral-400 text-xs tracking-widest uppercase">Promedio</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">RD${ticketPromedio}</p>
            </div>
          </div>

          <div className="space-y-4">
            {pedidosReales.length === 0 && (
              <p className="text-neutral-500 text-sm">No hay pedidos para esta fecha.</p>
            )}
            {[...pedidosReales]
              .sort((a, b) => (b.creadoEn?.toMillis() || 0) - (a.creadoEn?.toMillis() || 0))
              .map((p) => (
                <div key={p.id} className="border-b border-neutral-800 pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">Mesa {p.mesa}</p>
                      <p className="text-neutral-500 text-xs mb-2">
                        {p.creadoEn?.toDate().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <ul className="text-neutral-400 text-xs space-y-0.5">
                        {Object.values(
                          (p.items || []).reduce((acc, item) => {
                            if (!acc[item.nombre]) acc[item.nombre] = { ...item, cantidad: 0 };
                            acc[item.nombre].cantidad += 1;
                            return acc;
                          }, {})
                        ).map((item, i) => (
                          <li key={i}>{item.nombre} x{item.cantidad}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-400 font-bold">RD${p.total}</p>
                      <span className={`text-xs ${p.estado === 'archivado' ? 'text-neutral-500' : p.estado === 'listo' ? 'text-green-400' : 'text-amber-400'}`}>
                        {p.estado}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* Platos más pedidos */}
          <div className="border border-neutral-800 p-6 mt-8">
            <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Platos más pedidos</h2>
            <p className="text-neutral-500 text-xs mb-6">
              {esHoy
                ? 'Basado en los pedidos de hoy'
                : `Basado en pedidos del ${fechaSeleccionada.toLocaleDateString('es-DO', { month: 'long', day: 'numeric' })}`}
            </p>
            {(() => {
              const conteo = {};
              pedidosReales.forEach((p) => {
                (p.items || []).forEach((item) => {
                  if (!conteo[item.nombre]) conteo[item.nombre] = 0;
                  conteo[item.nombre] += 1;
                });
              });
              const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 10);
              if (ranking.length === 0) return <p className="text-neutral-500 text-sm">No hay datos todavía.</p>;
              const maximo = ranking[0][1];
              return (
                <div className="space-y-3">
                  {ranking.map(([nombre, cantidad], i) => (
                    <div key={nombre}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-white">
                          <span className="text-amber-400 mr-2">#{i + 1}</span>{nombre}
                        </span>
                        <span className="text-neutral-400 text-xs">{cantidad} {cantidad === 1 ? 'vez' : 'veces'}</span>
                      </div>
                      <div className="w-full bg-neutral-800 h-1">
                        <div className="bg-amber-400 h-1 transition-all" style={{ width: `${(cantidad / maximo) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <button
            onClick={generarCierrePDF}
            className="mt-6 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors w-full">
            ⬇ Descargar cierre de caja PDF
          </button>
        </div>

        {/* ── Códigos QR ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Códigos QR</h2>
          <div className="flex items-center gap-3 mb-6">
            <input
              type="number"
              min="1"
              max="50"
              placeholder="Número de mesas"
              value={numMesasQR}
              onChange={(e) => setNumMesasQR(e.target.value)}
              className="w-40 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base"
            />
            <span className="text-neutral-500 text-xs">mesas</span>
          </div>
          <div className="flex flex-wrap gap-6">
            {Array.from({ length: Number(numMesasQR) || 0 }, (_, i) => i + 1).map((mesa) => (
              <div key={mesa} className="flex flex-col items-center gap-2">
                <div className="bg-white p-3">
                  <QRCodeCanvas
                    value={`${window.location.origin}/restaurante/${restauranteId}/menu/${mesa}`}
                    size={90}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                </div>
                <p className="text-xs text-neutral-400">Mesa {mesa}</p>
                <button
                  onClick={() => setQrImprimiendo(mesa)}
                  className="text-xs border border-neutral-700 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                  Imprimir
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── UID del usuario ── */}
        <div className="mt-12 border-t border-neutral-800 pt-6 pb-8 text-center">
          <p className="text-neutral-700 text-xs mb-2">Tu identificador de usuario</p>
          <button onClick={copiarUid}
            className="text-neutral-600 text-xs font-mono hover:text-amber-400 transition-colors break-all">
            {getUid()}
          </button>
          <p className="text-neutral-700 text-xs mt-1">Toca para copiar — compártelo con el maestro para que te asigne acceso</p>
        </div>

      </div>

      {/* Modal QR impresión */}
      {qrImprimiendo && (
        <div style={{ position: 'fixed', inset: 0, background: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <button
            type="button"
            className="no-print"
            onClick={() => setQrImprimiendo(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: '#333', color: 'white', border: 'none', padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
            ✕ Cerrar
          </button>
          <div style={{ padding: 48, textAlign: 'center', fontFamily: 'Georgia, serif' }}>
            <QRCodeCanvas
              value={`${window.location.origin}/restaurante/${restauranteId}/menu/${qrImprimiendo}`}
              size={220}
              bgColor="#ffffff"
              fgColor="#000000"
            />
            <p style={{ marginTop: 16, fontSize: 13, color: '#666', letterSpacing: 3, textTransform: 'uppercase' }}>
              {nombreRestaurante}
            </p>
            <p style={{ marginTop: 8, fontSize: 24, fontWeight: 'bold', color: '#000', letterSpacing: 4, textTransform: 'uppercase' }}>
              Mesa {qrImprimiendo}
            </p>
          </div>
          <div className="no-print" style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={{ background: '#d97706', color: '#000', border: 'none', padding: '12px 32px', fontSize: 14, cursor: 'pointer', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 'bold' }}>
              🖨️ Imprimir
            </button>
            <button
              type="button"
              onClick={() => {
                const canvas = document.querySelector('#qr-print-modal canvas');
                if (!canvas) return;
                const link = document.createElement('a');
                link.download = `QR-Mesa-${qrImprimiendo}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
              }}
              style={{ background: '#000', color: '#fff', border: 'none', padding: '12px 32px', fontSize: 14, cursor: 'pointer', letterSpacing: 2, textTransform: 'uppercase' }}>
              ⬇ Descargar PNG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
