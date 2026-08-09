import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from 'react-router-dom';
import { verificarAccesoAdmin, guardarTiempos, guardarImpuestos, guardarHoraCierreOperativo } from '../services/restaurantesService';
import { subscribePlatos, guardarPlato, eliminarPlato, toggleDisponible } from '../services/platosService';
import { subscribePedidosDia, subscribePedidosPeriodo, subscribeVentasDiarias, actualizarEstadoMesa } from '../services/pedidosService';
import { logout, getUid } from '../services/authService';
import { rangoDiaOperativo, fechaOperativaHoy, parsearHoraCierre } from '../utils/fechaOperativa';

// Rango permitido para horaCierreOperativo — más allá de las 6 AM no tiene
// sentido operativo (sería un error de captura), ver Admin > configuración.
const HORA_CIERRE_MAX = 6 * 60;
const HORA_CIERRE_REGEX = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

function horaCierreValida(valor) {
  return HORA_CIERRE_REGEX.test(valor || '') && parsearHoraCierre(valor) <= HORA_CIERRE_MAX;
}

// "4:00 AM" a partir de minutos desde medianoche — formato fijo, no depende
// del locale del navegador (para que el encabezado del PDF sea consistente).
function formatHoraAmPm(minutos) {
  const h24 = Math.floor(minutos / 60) % 24;
  const min = minutos % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

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
  const [ventasDiarias, setVentasDiarias] = useState([]);
  const [fechaFiltro, setFechaFiltro] = useState(localDateStr);
  const [vistaVentas, setVistaVentas] = useState('dia');
  const [semanaBase, setSemanaBase] = useState(localDateStr());
  const [mesBase, setMesBase] = useState({ y: new Date().getFullYear(), m: new Date().getMonth() });
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState({
    nombre: '', nombreEn: '', precio: '', categoria: '', categoriaEn: '',
    descripcion: '', imagenUrl: '', disponible: true, tiempoMin: '', orden: '',
  });
  const [editandoId, setEditandoId] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [tiemposForm, setTiemposForm] = useState({});
  const [impuestosForm, setImpuestosForm] = useState({});
  const [horaCierreOperativo, setHoraCierreOperativo] = useState('00:00'); // valor guardado, usado para todos los cálculos
  const [horaCierreForm, setHoraCierreForm] = useState('00:00'); // valor del campo de configuración (puede diferir del guardado hasta que se guarda)
  const [horaCierreConfiguradaEn, setHoraCierreConfiguradaEn] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  const [confirmarEliminarId, setConfirmarEliminarId] = useState(null);
  const [confirmarCerrarMesaId, setConfirmarCerrarMesaId] = useState(null);

  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  const formVacio = {
    nombre: '', nombreEn: '', precio: '', categoria: '', categoriaEn: '',
    descripcion: '', imagenUrl: '', disponible: true, tiempoMin: '', orden: '',
  };

  // ─── Valores derivados ────────────────────────────────────
  const fechaSeleccionada = useMemo(() => {
    const [y, m, d] = fechaFiltro.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }, [fechaFiltro]);

  // "Hoy" es la fecha OPERATIVA actual, no la de calendario — si son las 2 AM
  // y el cierre es a las 4 AM, "hoy" todavía es el día operativo de ayer. No
  // se memoiza (igual que las llamadas a localDateStr() de antes): se
  // recalcula en cada render, así se mantiene razonablemente al día mientras
  // el panel sigue abierto.
  const hoyOperativoStr = fechaOperativaHoy(horaCierreOperativo);
  const esHoy = fechaFiltro === hoyOperativoStr;

  // Días de calendario que componen el período (Lunes-Domingo para semana,
  // 1º-último del mes para mes) — esto es agrupación por calendario, no
  // depende del día operativo. Lo que SÍ depende del día operativo es dónde
  // empieza y termina, en el tiempo real, el primer y el último de esos días
  // — eso lo resuelve rangoPeriodo más abajo con rangoDiaOperativo.
  const rangoFechasOperativas = useMemo(() => {
    if (vistaVentas === 'dia') return { primerDia: fechaFiltro, ultimoDia: fechaFiltro };
    if (vistaVentas === 'semana') {
      const ref = new Date(semanaBase + 'T12:00:00');
      const dow = ref.getDay();
      const diffMon = dow === 0 ? -6 : 1 - dow;
      const lun = new Date(ref); lun.setDate(ref.getDate() + diffMon);
      const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
      return { primerDia: localDateStr(lun), ultimoDia: localDateStr(dom) };
    }
    const inicioMes = new Date(mesBase.y, mesBase.m, 1);
    const finMes = new Date(mesBase.y, mesBase.m + 1, 0);
    return { primerDia: localDateStr(inicioMes), ultimoDia: localDateStr(finMes) };
  }, [vistaVentas, fechaFiltro, semanaBase, mesBase]);

  // Instantes reales [inicio, fin) del período, en la hora de cierre
  // operativo del restaurante — usado para consultar pedidos por creadoEn.
  const rangoPeriodo = useMemo(() => ({
    inicio: rangoDiaOperativo(rangoFechasOperativas.primerDia, horaCierreOperativo).inicio,
    fin: rangoDiaOperativo(rangoFechasOperativas.ultimoDia, horaCierreOperativo).fin,
  }), [rangoFechasOperativas, horaCierreOperativo]);

  const labelPeriodo = useMemo(() => {
    const fmt = (d, opts) => d.toLocaleDateString('es-DO', opts);
    // primerDia/ultimoDia son strings "YYYY-MM-DD" (días de calendario, sin
    // ambigüedad de zona horaria) — se anclan a mediodía local solo para
    // convertirlos a un objeto Date que Intl pueda formatear, igual que
    // desglosePorDia más abajo. OJO: rangoPeriodo.fin (día operativo) es
    // EXCLUSIVO — apunta al inicio del día siguiente — así que para mostrar
    // el último día del período se usa ultimoDia, no rangoPeriodo.fin.
    const diaTexto = (fechaStr, opts) => fmt(new Date(fechaStr + 'T12:00:00'), opts);
    if (vistaVentas === 'dia') return fmt(fechaSeleccionada, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (vistaVentas === 'semana') {
      return `${diaTexto(rangoFechasOperativas.primerDia, { day: 'numeric', month: 'short' })} – ${diaTexto(rangoFechasOperativas.ultimoDia, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return diaTexto(rangoFechasOperativas.primerDia, { month: 'long', year: 'numeric' });
  }, [vistaVentas, fechaSeleccionada, rangoFechasOperativas]);

  const pedidosReales = useMemo(
    () => pedidos.filter((p) => p.tipo !== 'llamada'),
    [pedidos]
  );

  // Día: los totales salen de los pedidos del propio día (nunca ha habido
  // riesgo de truncar, un restaurante no llega a cientos de pedidos en un día).
  // Semana/Mes: salen de ventasDiarias (agregado server-side por la Cloud
  // Function), no de sumar los pedidos individuales del período — así los
  // totales son siempre correctos sin importar cuántos pedidos haya.
  const totalDia = useMemo(() => {
    if (vistaVentas === 'dia') return pedidosReales.reduce((sum, p) => sum + (p.total || 0), 0);
    return ventasDiarias.reduce((sum, v) => sum + (v.total || 0), 0);
  }, [vistaVentas, pedidosReales, ventasDiarias]);

  const cantidadPedidosPeriodo = useMemo(() => {
    if (vistaVentas === 'dia') return pedidosReales.length;
    return ventasDiarias.reduce((sum, v) => sum + (v.cantidadPedidos || 0), 0);
  }, [vistaVentas, pedidosReales, ventasDiarias]);

  const ticketPromedio = useMemo(
    () => cantidadPedidosPeriodo > 0 ? Math.round(totalDia / cantidadPedidosPeriodo) : 0,
    [totalDia, cantidadPedidosPeriodo]
  );

  const desglosePorDia = useMemo(() => {
    if (vistaVentas === 'dia') return [];
    return [...ventasDiarias]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => ({ fecha: new Date(v.id + 'T12:00:00'), total: v.total || 0, cantidad: v.cantidadPedidos || 0 }));
  }, [ventasDiarias, vistaVentas]);

  // Ranking de platos más pedidos: en Día, sale de los pedidos (igual que
  // antes); en Semana/Mes, sale de los mapas `platos` ya sumados en cada
  // documento de ventasDiarias — evita releer todos los pedidos del período.
  const rankingPlatos = useMemo(() => {
    const conteo = {};
    if (vistaVentas === 'dia') {
      pedidosReales.forEach((p) => {
        (p.items || []).forEach((item) => {
          conteo[item.nombre] = (conteo[item.nombre] || 0) + 1;
        });
      });
    } else {
      ventasDiarias.forEach((v) => {
        Object.values(v.platos || {}).forEach(({ nombre, cantidad }) => {
          conteo[nombre] = (conteo[nombre] || 0) + (cantidad || 0);
        });
      });
    }
    return Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [vistaVentas, pedidosReales, ventasDiarias]);

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
    setTimeout(() => { if (montadoRef.current) setMensaje({ texto: '', tipo: '' }); }, 3500);
  }

  async function generarCierrePDF() {
    // jsPDF (y html2canvas, su dependencia) solo se descargan cuando el admin
    // pide el cierre de caja — el cliente del menú nunca carga este código,
    // y el admin tampoco lo descarga solo por abrir el panel.
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF();
    const labelVista = vistaVentas === 'dia' ? 'Día' : vistaVentas === 'semana' ? 'Semana' : 'Mes';

    pdf.setFontSize(20);
    pdf.text(`Cierre de Caja — ${labelVista}`, 105, 18, { align: 'center' });
    if (nombreRestaurante) {
      pdf.setFontSize(12);
      pdf.text(nombreRestaurante, 105, 27, { align: 'center' });
    }
    pdf.setFontSize(11);
    // Día con cierre operativo configurado: el "día" del reporte no va de
    // medianoche a medianoche, así que el encabezado lo dice explícitamente
    // — si no, "el total del domingo" incluiría o excluiría pedidos de forma
    // que no coincide con lo que el dueño espera ver. Con horaCierreOperativo
    // por defecto (00:00) no hace falta: el día operativo YA es el de
    // calendario, no se agrega nada.
    let labelPeriodoConHorario = labelPeriodo;
    if (vistaVentas === 'dia' && horaCierreOperativo !== '00:00') {
      const horaTexto = formatHoraAmPm(parsearHoraCierre(horaCierreOperativo));
      const diaSiguiente = new Date(fechaFiltro + 'T12:00:00');
      diaSiguiente.setDate(diaSiguiente.getDate() + 1);
      const nombreDiaSiguiente = diaSiguiente.toLocaleDateString('es-DO', { weekday: 'long' });
      labelPeriodoConHorario = `${labelPeriodo} — de ${horaTexto} a ${horaTexto} del ${nombreDiaSiguiente}`;
    }
    pdf.text(labelPeriodoConHorario, 105, nombreRestaurante ? 35 : 27, { align: 'center' });
    pdf.line(15, nombreRestaurante ? 40 : 32, 195, nombreRestaurante ? 40 : 32);

    pdf.setFontSize(13);
    const yBase = nombreRestaurante ? 50 : 42;
    const labelTotal = vistaVentas === 'dia' ? 'Total del día' : vistaVentas === 'semana' ? 'Total de la semana' : 'Total del mes';
    pdf.text(`${labelTotal}: RD$${totalDia}`, 15, yBase);
    pdf.text(`Pedidos: ${cantidadPedidosPeriodo}  |  Promedio: RD$${ticketPromedio}`, 15, yBase + 8);
    pdf.line(15, yBase + 13, 195, yBase + 13);

    let y = yBase + 21;

    // Desglose por día (solo semana/mes)
    if (vistaVentas !== 'dia' && desglosePorDia.length > 0) {
      pdf.setFontSize(12);
      pdf.text('Desglose por día:', 15, y);
      y += 7;
      pdf.setFontSize(10);
      desglosePorDia.forEach((d) => {
        if (y > 270) { pdf.addPage(); y = 15; }
        const label = d.fecha.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
        pdf.text(`${label} — ${d.cantidad} pedido(s) — RD$${d.total}`, 18, y);
        y += 6;
      });
      pdf.line(15, y, 195, y);
      y += 8;
    }

    // Platos más pedidos
    pdf.setFontSize(12);
    pdf.text('Platos más pedidos:', 15, y);
    y += 7;
    pdf.setFontSize(10);
    rankingPlatos.forEach(([nombre, cantidad], i) => {
      if (y > 270) { pdf.addPage(); y = 15; }
      pdf.text(`${i + 1}. ${nombre} — ${cantidad} ${cantidad === 1 ? 'vez' : 'veces'}`, 20, y);
      y += 7;
    });

    pdf.line(15, y, 195, y);
    y += 8;
    pdf.setFontSize(12);
    pdf.text('Detalle de pedidos:', 15, y);
    y += 8;
    pdf.setFontSize(9);

    [...pedidosReales]
      .sort((a, b) => (a.creadoEn?.toMillis() || 0) - (b.creadoEn?.toMillis() || 0))
      .forEach((p) => {
        if (y > 270) { pdf.addPage(); y = 15; }
        const fecha = p.creadoEn?.toDate();
        const horaStr = fecha?.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
        const diaStr = vistaVentas !== 'dia'
          ? fecha?.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' }) + ' '
          : '';
        pdf.text(`Mesa ${p.mesa} — ${diaStr}${horaStr} — RD$${p.total}`, 15, y);
        y += 6;
        (p.items || []).forEach((item) => {
          if (y > 270) { pdf.addPage(); y = 15; }
          pdf.text(`   · ${item.nombre}`, 15, y);
          y += 5;
        });
        y += 2;
      });

    const fileLabel = vistaVentas === 'dia' ? fechaFiltro : labelPeriodo.replace(/[^a-zA-Z0-9-]/g, '_');
    pdf.save(`cierre-${vistaVentas}-${fileLabel}.pdf`);
  }

  // ─── Effect 1: acceso + platos ────────────────────────────
  useEffect(() => {
    verificarAccesoAdmin(restauranteId)
      .then(({ acceso: ok, nombre, tiempos, impuestos, horaCierreOperativo: hc, horaCierreConfiguradaEn: hcFecha }) => {
        if (!montadoRef.current) return;
        setAcceso(ok);
        if (ok) {
          setNombreRestaurante(nombre);
          setTiemposForm(tiempos);
          setImpuestosForm(impuestos);
          setHoraCierreOperativo(hc);
          setHoraCierreForm(hc);
          // Normalizado a Date de una vez — así el resto del componente nunca
          // necesita saber si vino de Firestore (Timestamp) o de un guardado
          // optimista recién hecho (Date directo).
          setHoraCierreConfiguradaEn(hcFecha?.toDate ? hcFecha.toDate() : null);
          // "Hoy" recién ahora se puede calcular bien — antes de esto no se
          // conocía el cierre operativo real del restaurante. Reancla la
          // vista a la fecha operativa correcta (sin esto, si el cierre no
          // es 00:00, el panel podría abrir mostrando el día equivocado
          // durante la carga inicial).
          const hoy = fechaOperativaHoy(hc);
          setFechaFiltro(hoy);
          setSemanaBase(hoy);
          const [y, m] = hoy.split('-').map(Number);
          setMesBase({ y, m: m - 1 });
        }
      })
      .catch((e) => {
        console.error('Error verificando acceso admin:', e);
        if (montadoRef.current) setAcceso(false);
      });

    return subscribePlatos(restauranteId, setPlatos);
  }, [restauranteId]);

  // ─── Effect 2: pedidos del período ───────────────────────
  useEffect(() => {
    if (acceso !== true) return;
    if (vistaVentas === 'dia') return subscribePedidosDia(restauranteId, fechaFiltro, horaCierreOperativo, setPedidos);
    return subscribePedidosPeriodo(restauranteId, rangoPeriodo.inicio, rangoPeriodo.fin, setPedidos);
  }, [restauranteId, fechaFiltro, acceso, vistaVentas, rangoPeriodo, horaCierreOperativo]);

  // ─── Effect 2b: ventas diarias agregadas (solo semana/mes) ───────────────
  // En vista Día no se suscribe (los memos de arriba ignoran ventasDiarias
  // mientras vistaVentas === 'dia', así que dejar el estado anterior sin
  // limpiar aquí es inofensivo y evita un setState síncrono dentro del efecto).
  // Los IDs de ventasDiarias son fechas operativas (rangoFechasOperativas),
  // no se derivan de rangoPeriodo.inicio/fin — ese rango ya no es medianoche
  // a medianoche, y su `fin` es además exclusivo (apunta al día siguiente).
  useEffect(() => {
    if (acceso !== true || vistaVentas === 'dia') return;
    return subscribeVentasDiarias(
      restauranteId, rangoFechasOperativas.primerDia, rangoFechasOperativas.ultimoDia, setVentasDiarias
    );
  }, [restauranteId, acceso, vistaVentas, rangoFechasOperativas]);

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
      if (!montadoRef.current) return;
      setEditandoId(null);
      setForm(formVacio);
      setImagen(null);
      setFileKey((k) => k + 1);
      mostrarMensaje('Plato guardado correctamente.', 'ok');
    } catch (e) {
      console.error('Error guardando plato:', e);
      if (montadoRef.current) {
        mostrarMensaje(
          e.message === 'La imagen supera los 3MB.' ? e.message : 'Error al guardar. Intenta de nuevo.',
          'error'
        );
      }
    } finally {
      if (montadoRef.current) setGuardando(false);
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
      if (montadoRef.current) setConfirmarEliminarId(null);
    } catch (e) {
      console.error('Error eliminando:', e);
      if (montadoRef.current) mostrarMensaje('Error al eliminar el plato.', 'error');
    }
  };

  const handleGuardarTiempos = async () => {
    try {
      await guardarTiempos(restauranteId, tiemposForm);
      if (montadoRef.current) mostrarMensaje('Tiempos guardados.', 'ok');
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al guardar tiempos.', 'error');
    }
  };

  const handleGuardarImpuestos = async () => {
    try {
      await guardarImpuestos(restauranteId, {
        ...impuestosForm,
        itbisPorcentaje: Number(impuestosForm.itbisPorcentaje) || 0,
        propinaPorcentaje: Number(impuestosForm.propinaPorcentaje) || 0,
      });
      if (montadoRef.current) mostrarMensaje('Impuestos guardados.', 'ok');
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al guardar impuestos.', 'error');
    }
  };

  const handleGuardarHoraCierre = async () => {
    if (!horaCierreValida(horaCierreForm)) {
      mostrarMensaje('La hora de cierre debe estar entre 00:00 y 06:00.', 'error');
      return;
    }
    try {
      await guardarHoraCierreOperativo(restauranteId, horaCierreForm);
      if (!montadoRef.current) return;
      setHoraCierreOperativo(horaCierreForm);
      setHoraCierreConfiguradaEn(new Date()); // reflejo optimista de lo que la Cloud Function acaba de guardar
      mostrarMensaje('Hora de cierre guardada.', 'ok');
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al guardar la hora de cierre.', 'error');
    }
  };

  const copiarUid = async () => {
    const uid = getUid();
    if (!uid) return;
    try {
      await navigator.clipboard.writeText(uid);
      if (montadoRef.current) mostrarMensaje('UID copiado al portapapeles.', 'ok');
    } catch {
      if (montadoRef.current) mostrarMensaje(`UID: ${uid}`, 'ok');
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
          <div>
            <input name="nombreEn" placeholder="Nombre en inglés (opcional)" value={form.nombreEn} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
            <p className="text-neutral-600 text-xs mt-1">Si lo dejas vacío, se mostrará el nombre en español.</p>
          </div>
          <input name="precio" placeholder="Precio *" type="number" value={form.precio} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <input name="categoria" placeholder="Categoría *" value={form.categoria} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <div>
            <input name="categoriaEn" placeholder="Categoría en inglés (opcional)" value={form.categoriaEn} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
            <p className="text-neutral-600 text-xs mt-1">Si lo dejas vacío, se mostrará la categoría en español.</p>
          </div>
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
                  className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors min-h-[44px]">
                  Editar
                </button>
                <button
                  onClick={() => toggleDisponible(restauranteId, p.id, p.disponible !== false)}
                  className={`text-xs border px-3 py-1 transition-colors min-h-[44px] ${p.disponible !== false
                    ? 'border-neutral-600 text-neutral-400 hover:border-red-400 hover:text-red-400'
                    : 'border-amber-400 text-amber-400'}`}>
                  {p.disponible !== false ? 'Desactivar' : 'Activar'}
                </button>
                {confirmarEliminarId === p.id ? (
                  <>
                    <button onClick={() => eliminar(p.id)}
                      className="text-xs border border-red-400 text-red-400 px-3 py-1 transition-colors min-h-[44px]">
                      ¿Confirmar?
                    </button>
                    <button onClick={() => setConfirmarEliminarId(null)}
                      className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 transition-colors min-h-[44px]">
                      No
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmarEliminarId(p.id)}
                    className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors min-h-[44px]">
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

        {/* ── Día operativo ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Hora de cierre del día operativo</h2>
          <p className="text-neutral-500 text-xs mb-4">
            Si tu restaurante sirve hasta la madrugada, pon aquí la hora en que cierras. Todo lo que se venda antes
            de esa hora contará como el día anterior. Ejemplo: si cierras a las 3:00 AM, una venta del lunes a la
            1:00 AM aparecerá en el reporte del domingo.
          </p>
          <div className="flex items-center gap-3">
            <label className="text-neutral-400 text-sm w-32">Hora de cierre</label>
            <input type="time" step="60" min="00:00" max="06:00" value={horaCierreForm}
              onChange={(e) => setHoraCierreForm(e.target.value)}
              className="w-32 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-base" />
          </div>
          <p className="text-neutral-600 text-xs mt-3">
            Con esta configuración, tu día del lunes va desde el lunes {formatHoraAmPm(parsearHoraCierre(horaCierreForm))} hasta
            el martes {formatHoraAmPm(parsearHoraCierre(horaCierreForm))}.
          </p>
          <button onClick={handleGuardarHoraCierre}
            className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors min-h-[44px]">
            Guardar hora de cierre
          </button>
        </div>

        {/* ── Impuestos ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Impuestos</h2>
          <p className="text-neutral-500 text-xs mb-4">
            Los precios del menú se muestran sin impuestos. Actívalos aquí si tu restaurante los cobra aparte.
          </p>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <label className="text-neutral-400 text-sm">Cobrar ITBIS</label>
              <button
                onClick={() => setImpuestosForm((f) => ({ ...f, itbisActivo: !f.itbisActivo }))}
                className={`text-xs border px-3 py-2 min-h-[44px] transition-colors ${
                  impuestosForm.itbisActivo
                    ? 'border-amber-400 text-amber-400'
                    : 'border-neutral-600 text-neutral-400 hover:border-amber-400 hover:text-amber-400'}`}>
                {impuestosForm.itbisActivo ? 'Activado' : 'Desactivado'}
              </button>
            </div>
            {impuestosForm.itbisActivo && (
              <div className="flex items-center gap-3">
                <label className="text-neutral-400 text-sm w-32">Porcentaje ITBIS</label>
                <input type="number" value={impuestosForm.itbisPorcentaje ?? ''}
                  onChange={(e) => setImpuestosForm((f) => ({ ...f, itbisPorcentaje: e.target.value }))}
                  className="w-24 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-base" />
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <label className="text-neutral-400 text-sm">Cobrar propina legal</label>
              <button
                onClick={() => setImpuestosForm((f) => ({ ...f, propinaActivo: !f.propinaActivo }))}
                className={`text-xs border px-3 py-2 min-h-[44px] transition-colors ${
                  impuestosForm.propinaActivo
                    ? 'border-amber-400 text-amber-400'
                    : 'border-neutral-600 text-neutral-400 hover:border-amber-400 hover:text-amber-400'}`}>
                {impuestosForm.propinaActivo ? 'Activado' : 'Desactivado'}
              </button>
            </div>
            {impuestosForm.propinaActivo && (
              <div className="flex items-center gap-3">
                <label className="text-neutral-400 text-sm w-32">Porcentaje propina</label>
                <input type="number" value={impuestosForm.propinaPorcentaje ?? ''}
                  onChange={(e) => setImpuestosForm((f) => ({ ...f, propinaPorcentaje: e.target.value }))}
                  className="w-24 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-base" />
              </div>
            )}
          </div>
          <button onClick={handleGuardarImpuestos}
            className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors min-h-[44px]">
            Guardar impuestos
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
                        className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-amber-400 hover:text-amber-400 transition-colors min-h-[44px]">
                        Marcar lista
                      </button>
                    )}
                    {confirmarCerrarMesaId === mesa.mesa ? (
                      <>
                        <button
                          onClick={() => { archivarMesaAdmin(mesa.ids); setConfirmarCerrarMesaId(null); }}
                          className="text-xs border border-red-400 text-red-400 px-3 py-1 transition-colors min-h-[44px]">
                          ¿Confirmar cierre?
                        </button>
                        <button onClick={() => setConfirmarCerrarMesaId(null)}
                          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 transition-colors min-h-[44px]">
                          No
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmarCerrarMesaId(mesa.mesa)}
                        className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors min-h-[44px]">
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
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-4">Ventas</h2>

          {/* Aviso de discontinuidad: los reportes de antes de configurar el
              cierre operativo se calcularon con día de calendario (medianoche
              a medianoche), no con esta hora de cierre. No se recalculan
              solos — ver nota de la Tarea 5 del brief en el historial de este
              cambio para el porqué. */}
          {horaCierreOperativo !== '00:00' && horaCierreConfiguradaEn && (
            <p className="text-neutral-500 text-xs border border-neutral-800 bg-neutral-900 px-3 py-2 mb-4">
              Los reportes de fechas anteriores al {horaCierreConfiguradaEn.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })} usan
              el día de calendario (medianoche a medianoche), no tu hora de cierre configurada.
            </p>
          )}

          {/* Tabs */}
          <div className="flex border border-neutral-700 mb-4 w-fit">
            {['dia', 'semana', 'mes'].map((v) => (
              <button key={v} onClick={() => setVistaVentas(v)}
                className={`px-4 py-2 text-xs tracking-widest uppercase transition-colors ${
                  vistaVentas === v ? 'bg-amber-400 text-black font-bold' : 'text-neutral-400 hover:text-white'
                }`}>
                {v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>

          {/* Navegación de período */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {vistaVentas === 'dia' && (
              <>
                <button onClick={() => {
                  const d = new Date(fechaFiltro + 'T12:00:00'); d.setDate(d.getDate() - 1);
                  setFechaFiltro(localDateStr(d));
                }} className="text-neutral-400 hover:text-white px-2 py-1 border border-neutral-700 hover:border-neutral-500">◀</button>
                <input type="date" value={fechaFiltro} max={hoyOperativoStr}
                  onChange={(e) => { if (e.target.value) setFechaFiltro(e.target.value); }}
                  className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-base" />
                <button onClick={() => {
                  const d = new Date(fechaFiltro + 'T12:00:00'); d.setDate(d.getDate() + 1);
                  if (localDateStr(d) <= hoyOperativoStr) setFechaFiltro(localDateStr(d));
                }} className="text-neutral-400 hover:text-white px-2 py-1 border border-neutral-700 hover:border-neutral-500">▶</button>
              </>
            )}
            {vistaVentas === 'semana' && (
              <>
                <button onClick={() => {
                  const d = new Date(semanaBase + 'T12:00:00'); d.setDate(d.getDate() - 7);
                  setSemanaBase(localDateStr(d));
                }} className="text-neutral-400 hover:text-white px-2 py-1 border border-neutral-700 hover:border-neutral-500">◀</button>
                <span className="text-white text-sm">{labelPeriodo}</span>
                <button onClick={() => {
                  const d = new Date(semanaBase + 'T12:00:00'); d.setDate(d.getDate() + 7);
                  if (localDateStr(d) <= hoyOperativoStr) setSemanaBase(localDateStr(d));
                }} className="text-neutral-400 hover:text-white px-2 py-1 border border-neutral-700 hover:border-neutral-500">▶</button>
              </>
            )}
            {vistaVentas === 'mes' && (
              <>
                <button onClick={() => {
                  setMesBase((prev) => {
                    const m = prev.m === 0 ? 11 : prev.m - 1;
                    const y = prev.m === 0 ? prev.y - 1 : prev.y;
                    return { y, m };
                  });
                }} className="text-neutral-400 hover:text-white px-2 py-1 border border-neutral-700 hover:border-neutral-500">◀</button>
                <span className="text-white text-sm capitalize">{labelPeriodo}</span>
                <button onClick={() => {
                  setMesBase((prev) => {
                    const [hy, hm] = hoyOperativoStr.split('-').map(Number);
                    if (prev.y === hy && prev.m === hm - 1) return prev;
                    const m = prev.m === 11 ? 0 : prev.m + 1;
                    const y = prev.m === 11 ? prev.y + 1 : prev.y;
                    return { y, m };
                  });
                }} className="text-neutral-400 hover:text-white px-2 py-1 border border-neutral-700 hover:border-neutral-500">▶</button>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="border border-neutral-700 p-4">
              <p className="text-neutral-400 text-xs tracking-widest uppercase">
                {vistaVentas === 'dia' ? 'Total día' : vistaVentas === 'semana' ? 'Total semana' : 'Total mes'}
              </p>
              <p className="text-2xl font-bold text-amber-400 mt-1">RD${totalDia}</p>
            </div>
            <div className="border border-neutral-700 p-4">
              <p className="text-neutral-400 text-xs tracking-widest uppercase">Pedidos</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{cantidadPedidosPeriodo}</p>
            </div>
            <div className="border border-neutral-700 p-4">
              <p className="text-neutral-400 text-xs tracking-widest uppercase">Promedio</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">RD${ticketPromedio}</p>
            </div>
          </div>

          {/* Desglose por día (semana/mes) */}
          {vistaVentas !== 'dia' && desglosePorDia.length > 0 && (
            <div className="border border-neutral-800 p-4 mb-6 space-y-2">
              <p className="text-neutral-500 text-xs tracking-widest uppercase mb-3">Desglose por día</p>
              {desglosePorDia.map((d, i) => (
                <div key={i} className="flex justify-between items-center text-sm border-b border-neutral-800 pb-2 last:border-0">
                  <span className="text-neutral-300 capitalize">
                    {d.fecha.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <div className="text-right">
                    <span className="text-amber-400 font-bold">RD${d.total}</span>
                    <span className="text-neutral-600 text-xs ml-2">{d.cantidad} pedido{d.cantidad !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4">
            {pedidosReales.length === 0 && (
              <p className="text-neutral-500 text-sm">No hay pedidos para este período.</p>
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
              if (rankingPlatos.length === 0) return <p className="text-neutral-500 text-sm">No hay datos todavía.</p>;
              const maximo = rankingPlatos[0][1];
              return (
                <div className="space-y-3">
                  {rankingPlatos.map(([nombre, cantidad], i) => (
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
            ⬇ Cierre de caja — {vistaVentas === 'dia' ? 'Día' : vistaVentas === 'semana' ? 'Semana' : 'Mes'}
          </button>
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
    </div>
  );
}
