import { useState, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  subscribeRestaurantes, crearRestaurante, actualizarNombre,
  eliminarRestaurante, agregarUid, quitarUid, guardarMesaTokens,
} from '../services/restaurantesService';
import { logout } from '../services/authService';

function PanelMaestro() {
  const [restaurantes, setRestaurantes] = useState([]);
  const [nombre, setNombre] = useState('');
  const [mesasPor, setMesasPor] = useState({});
  const [qrImprimiendo, setQrImprimiendo] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [nombreEditar, setNombreEditar] = useState('');
  const [confirmarEliminarId, setConfirmarEliminarId] = useState(null);
  const [accesoAbierto, setAccesoAbierto] = useState(null);
  const [nuevoUid, setNuevoUid] = useState({});

  useEffect(() => {
    return subscribeRestaurantes(setRestaurantes);
  }, []);

  // Genera tokens para mesas que no los tienen aún
  useEffect(() => {
    restaurantes.forEach((r) => {
      const n = Number(mesasPor[r.id]) || 0;
      if (!n) return;
      const faltantes = Array.from({ length: n }, (_, i) => String(i + 1))
        .filter((m) => !r.mesaTokens?.[m]);
      if (faltantes.length === 0) return;
      const nuevos = { ...(r.mesaTokens || {}) };
      faltantes.forEach((m) => {
        nuevos[m] = typeof crypto?.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      });
      guardarMesaTokens(r.id, nuevos).catch(console.error);
    });
  }, [mesasPor, restaurantes]);

  async function cerrarSesion() {
    try { await logout(); } catch (e) { console.error(e); }
  }

  async function handleCrear() {
    if (!nombre.trim()) return;
    await crearRestaurante(nombre.trim());
    setNombre('');
  }

  async function guardarEdicion(id) {
    if (!nombreEditar.trim()) return;
    await actualizarNombre(id, nombreEditar.trim());
    setEditandoId(null);
    setNombreEditar('');
  }

  async function handleEliminar(id) {
    await eliminarRestaurante(id);
    setConfirmarEliminarId(null);
  }

  function descargarQR() {
    const canvas = document.querySelector('#print-area canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `QR-Mesa-${qrImprimiendo.mesa}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function getNuevoUid(restauranteId, tipo) {
    return nuevoUid[restauranteId]?.[tipo] || '';
  }

  function setNuevoUidCampo(restauranteId, tipo, valor) {
    setNuevoUid((prev) => ({
      ...prev,
      [restauranteId]: { ...prev[restauranteId], [tipo]: valor },
    }));
  }

  async function handleAgregarUid(restauranteId, campo, uid) {
    if (!uid.trim()) return;
    await agregarUid(restauranteId, campo, uid);
    setNuevoUidCampo(restauranteId, campo === 'adminUids' ? 'admin' : 'cocina', '');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">

      {/* Header */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center">
        <div>
          <p className="text-amber-400 text-xs tracking-widest uppercase">Panel</p>
          <h1 className="text-2xl font-bold">Maestro</h1>
        </div>
        <button onClick={cerrarSesion}
          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
          Cerrar sesión
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Formulario nuevo restaurante */}
        <div className="border border-neutral-800 p-6 mb-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Nuevo restaurante</h2>
          <div className="flex gap-3">
            <input
              placeholder="Nombre del restaurante"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCrear()}
              className="flex-1 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base"
            />
            <button onClick={handleCrear}
              className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors">
              Crear
            </button>
          </div>
        </div>

        {/* Lista de restaurantes */}
        <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Restaurantes</h2>
        <div className="space-y-4">
          {restaurantes.map((r) => (
            <div key={r.id} className="border border-neutral-800 p-4">

              {/* Nombre editable */}
              {editandoId === r.id ? (
                <div className="flex gap-2 mb-2">
                  <input
                    value={nombreEditar}
                    onChange={(e) => setNombreEditar(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && guardarEdicion(r.id)}
                    autoFocus
                    className="flex-1 bg-neutral-900 border border-amber-400 px-3 py-1 text-white text-base focus:outline-none"
                  />
                  <button onClick={() => guardarEdicion(r.id)}
                    className="text-xs bg-amber-400 text-black px-3 py-1 font-bold">
                    Guardar
                  </button>
                  <button onClick={() => setEditandoId(null)}
                    className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 mb-1">
                  <p className="font-bold text-lg flex-1">{r.nombre}</p>
                  <button onClick={() => { setEditandoId(r.id); setNombreEditar(r.nombre); }}
                    className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                    Editar
                  </button>
                  {confirmarEliminarId === r.id ? (
                    <div className="flex gap-2 items-center">
                      <span className="text-xs text-red-400">¿Eliminar?</span>
                      <button onClick={() => handleEliminar(r.id)}
                        className="text-xs border border-red-400 text-red-400 px-3 py-1 transition-colors">
                        Sí
                      </button>
                      <button onClick={() => setConfirmarEliminarId(null)}
                        className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 transition-colors">
                        No
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmarEliminarId(r.id)}
                      className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors">
                      Eliminar
                    </button>
                  )}
                </div>
              )}

              <p className="text-neutral-500 text-xs mt-1 mb-3">ID: {r.id}</p>

              <div className="flex gap-4 text-xs text-amber-400 mb-4">
                <a href={`/restaurante/${r.id}/admin`} className="hover:underline">Admin →</a>
                <a href={`/restaurante/${r.id}/cocina`} className="hover:underline">Cocina →</a>
              </div>

              {/* Gestionar acceso */}
              <button
                onClick={() => setAccesoAbierto(accesoAbierto === r.id ? null : r.id)}
                className="text-xs text-neutral-500 hover:text-amber-400 transition-colors mb-3">
                {accesoAbierto === r.id ? '▼' : '▶'} Gestionar acceso
              </button>

              {accesoAbierto === r.id && (
                <div className="border border-neutral-800 p-4 space-y-5 mb-4">

                  {/* Admins */}
                  <div>
                    <p className="text-xs text-amber-400 tracking-widest uppercase mb-2">Admins</p>
                    {(r.adminUids || []).length === 0
                      ? <p className="text-neutral-600 text-xs mb-2">Sin admins asignados</p>
                      : (r.adminUids || []).map((uid) => (
                        <div key={uid} className="flex items-center justify-between mb-1">
                          <span className="text-neutral-400 text-xs font-mono truncate flex-1 mr-2">{uid}</span>
                          <button onClick={() => quitarUid(r.id, 'adminUids', uid)}
                            className="text-xs text-red-400 hover:text-red-300 shrink-0">
                            Quitar
                          </button>
                        </div>
                      ))}
                    <div className="flex gap-2 mt-2">
                      <input
                        placeholder="UID de Firebase"
                        value={getNuevoUid(r.id, 'admin')}
                        onChange={(e) => setNuevoUidCampo(r.id, 'admin', e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAgregarUid(r.id, 'adminUids', getNuevoUid(r.id, 'admin'))}
                        className="flex-1 bg-neutral-900 border border-neutral-700 px-2 py-1 text-white text-base placeholder-neutral-600 focus:outline-none focus:border-amber-400 font-mono"
                      />
                      <button onClick={() => handleAgregarUid(r.id, 'adminUids', getNuevoUid(r.id, 'admin'))}
                        className="text-xs bg-amber-400 text-black px-3 py-1 font-bold hover:bg-amber-300">
                        Agregar
                      </button>
                    </div>
                  </div>

                  {/* Cocina */}
                  <div>
                    <p className="text-xs text-amber-400 tracking-widest uppercase mb-2">Cocina</p>
                    {(r.cocinaUids || []).length === 0
                      ? <p className="text-neutral-600 text-xs mb-2">Sin usuarios de cocina asignados</p>
                      : (r.cocinaUids || []).map((uid) => (
                        <div key={uid} className="flex items-center justify-between mb-1">
                          <span className="text-neutral-400 text-xs font-mono truncate flex-1 mr-2">{uid}</span>
                          <button onClick={() => quitarUid(r.id, 'cocinaUids', uid)}
                            className="text-xs text-red-400 hover:text-red-300 shrink-0">
                            Quitar
                          </button>
                        </div>
                      ))}
                    <div className="flex gap-2 mt-2">
                      <input
                        placeholder="UID de Firebase"
                        value={getNuevoUid(r.id, 'cocina')}
                        onChange={(e) => setNuevoUidCampo(r.id, 'cocina', e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAgregarUid(r.id, 'cocinaUids', getNuevoUid(r.id, 'cocina'))}
                        className="flex-1 bg-neutral-900 border border-neutral-700 px-2 py-1 text-white text-base placeholder-neutral-600 focus:outline-none focus:border-amber-400 font-mono"
                      />
                      <button onClick={() => handleAgregarUid(r.id, 'cocinaUids', getNuevoUid(r.id, 'cocina'))}
                        className="text-xs bg-amber-400 text-black px-3 py-1 font-bold hover:bg-amber-300">
                        Agregar
                      </button>
                    </div>
                  </div>

                </div>
              )}

              {/* Número de mesas */}
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="number"
                  min="1"
                  placeholder="Número de mesas"
                  className="bg-neutral-900 border border-neutral-700 px-3 py-1 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 w-40 text-base"
                  onChange={(e) => {
                    const valor = Number(e.target.value);
                    if (valor >= 1) setMesasPor({ ...mesasPor, [r.id]: valor });
                  }}
                />
                <span className="text-neutral-500 text-xs">mesas</span>
              </div>

              {/* QR por mesa */}
              <div className="flex flex-wrap gap-6">
                {Array.from({ length: mesasPor[r.id] || 0 }, (_, i) => i + 1).map((mesa) => (
                  <div key={mesa} className="flex flex-col items-center gap-2">
                    <div className="bg-white p-4">
                      <QRCodeCanvas
                        value={`${import.meta.env.VITE_BASE_URL || window.location.origin}/restaurante/${r.id}/menu/${mesa}?t=${r.mesaTokens?.[String(mesa)] || ''}`}
                        size={100}
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                    </div>
                    <p className="text-xs text-neutral-400">Mesa {mesa}</p>
                    <button
                      onClick={() => setQrImprimiendo({ restauranteId: r.id, mesa, nombreRestaurante: r.nombre, token: r.mesaTokens?.[String(mesa)] || '' })}
                      className="text-xs border border-neutral-700 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors">
                      Imprimir
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal QR */}
      {qrImprimiendo && (
        <div style={{ position: 'fixed', inset: 0, background: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <button
            type="button"
            className="no-print"
            onClick={() => setQrImprimiendo(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: '#333', color: 'white', border: 'none', padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
            ✕ Cerrar
          </button>
          <div id="print-area" style={{ padding: 48, textAlign: 'center', fontFamily: 'Georgia, serif' }}>
            <QRCodeCanvas
              value={`${import.meta.env.VITE_BASE_URL || window.location.origin}/restaurante/${qrImprimiendo.restauranteId}/menu/${qrImprimiendo.mesa}?t=${qrImprimiendo.token}`}
              size={220}
              bgColor="#ffffff"
              fgColor="#000000"
            />
            <p style={{ marginTop: 16, fontSize: 13, color: '#666', letterSpacing: 3, textTransform: 'uppercase' }}>
              {qrImprimiendo.nombreRestaurante}
            </p>
            <p style={{ marginTop: 8, fontSize: 24, fontWeight: 'bold', color: '#000', letterSpacing: 4, textTransform: 'uppercase' }}>
              Mesa {qrImprimiendo.mesa}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => {
                const canvas = document.querySelector('#print-area canvas');
                if (!canvas) return;
                const url = canvas.toDataURL('image/png');
                const ventana = window.open('', '_blank', 'width=400,height=500');
                ventana.document.write(`
                  <html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Georgia,serif;background:white">
                    <img src="${url}" style="width:220px;height:220px"/>
                    <p style="margin-top:16px;font-size:13px;color:#666;letter-spacing:3px;text-transform:uppercase">${qrImprimiendo.nombreRestaurante}</p>
                    <p style="margin-top:8px;font-size:24px;font-weight:bold;color:#000;letter-spacing:4px;text-transform:uppercase">Mesa ${qrImprimiendo.mesa}</p>
                    <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>
                  </body></html>
                `);
                ventana.document.close();
              }}
              style={{ background: '#d97706', color: '#000', border: 'none', padding: '12px 32px', fontSize: 14, cursor: 'pointer', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 'bold' }}>
              🖨️ Imprimir
            </button>
            <button
              type="button"
              onClick={descargarQR}
              style={{ background: '#000', color: '#fff', border: 'none', padding: '12px 32px', fontSize: 14, cursor: 'pointer', letterSpacing: 2, textTransform: 'uppercase' }}>
              ⬇ Descargar PNG
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default PanelMaestro;
