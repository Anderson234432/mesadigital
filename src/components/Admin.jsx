import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from 'react-router-dom';
import {
  verificarAccesoAdmin, guardarTiempos, guardarImpuestos,
  guardarMarca, guardarHorarios, guardarBotones,
} from '../services/restaurantesService';
import { subscribePlatos, guardarPlato, eliminarPlato, toggleDisponible } from '../services/platosService';
import { subscribePedidosDia, subscribePedidosPeriodo, subscribeVentasDiarias, actualizarEstadoMesa } from '../services/pedidosService';
import { logout, getUid } from '../services/authService';
import { rangoDiaOperativo, fechaOperativaHoy, parsearHoraCierre } from '../utils/fechaOperativa';
import { derivarHoraCierreOperativo } from '../utils/horarioRestaurante';
import { subirImagenMarca } from '../services/storageService';
import { destinoBotonValido, normalizarDestinoBoton, migrarDestinosDesdeContacto } from '../utils/contacto';
import {
  subscribeCategorias, guardarMeta as guardarMetaCategoria,
  subirImagen as subirImagenCategoriaMeta, quitarImagen as quitarImagenCategoriaMeta,
} from '../services/categoriasService';
import { listarCategorias, listarSubcategorias } from '../utils/menuCategorias';
import { slugify, slugSubcategoria } from '../utils/slug';

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DIAS_SEMANA_LABEL = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};
const HORARIO_DIA_VACIO = { abre: '', cierra: '', cerrado: false };
const TIPOS_BOTON = [
  { tipo: 'carta', label: 'Ver carta' },
  { tipo: 'mapa', label: 'Cómo llegar (mapa)' },
  { tipo: 'whatsapp', label: 'WhatsApp' },
  { tipo: 'instagram', label: 'Instagram' },
  { tipo: 'telefono', label: 'Llamar' },
  { tipo: 'enlace', label: 'Enlace libre (reservas, eventos, etc.)' },
];
const AYUDA_DESTINO = {
  mapa: 'Pega el enlace de Google Maps. En Maps: busca tu restaurante → Compartir → Copiar vínculo.',
  whatsapp: 'Número con código de país. Ej: 18095551234',
  instagram: '@usuario o el enlace completo',
  telefono: 'Número a llamar',
  enlace: 'Cualquier URL. Úsalo para reservaciones, eventos, lo que necesites.',
};

function nuevoBotonId() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const [categoriasMeta, setCategoriasMeta] = useState([]);
  const [categoriaFileKeys, setCategoriaFileKeys] = useState({});
  // Estado por slug (categoría o subcategoría) — mensaje de error PERSISTENTE
  // (no se autodescarta como el toast de mostrarMensaje) y bandera de
  // "subiendo", para que una falla nunca se sienta como que no pasó nada.
  const [categoriasSubiendo, setCategoriasSubiendo] = useState({});
  const [categoriasError, setCategoriasError] = useState({});
  const [pedidos, setPedidos] = useState([]);
  const [ventasDiarias, setVentasDiarias] = useState([]);
  const [fechaFiltro, setFechaFiltro] = useState(localDateStr);
  const [vistaVentas, setVistaVentas] = useState('dia');
  const [semanaBase, setSemanaBase] = useState(localDateStr());
  const [mesBase, setMesBase] = useState({ y: new Date().getFullYear(), m: new Date().getMonth() });
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState({
    nombre: '', nombreEn: '', precio: '', categoria: '', categoriaEn: '',
    subcategoria: '', subcategoriaEn: '',
    descripcion: '', imagenUrl: '', disponible: true, tiempoMin: '', orden: '',
  });
  const [editandoId, setEditandoId] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [tiemposForm, setTiemposForm] = useState({});
  const [impuestosForm, setImpuestosForm] = useState({});
  const [horaCierreOperativo, setHoraCierreOperativo] = useState('00:00'); // valor guardado, usado para todos los cálculos — derivado de horariosForm al guardar
  const [horaCierreConfiguradaEn, setHoraCierreConfiguradaEn] = useState(null);
  const [marcaForm, setMarcaForm] = useState({ logoUrl: '', portadaUrl: '', eslogan: '', direccion: '' });
  const [logoFile, setLogoFile] = useState(null);
  const [portadaFile, setPortadaFile] = useState(null);
  const [subiendoMarca, setSubiendoMarca] = useState(false);
  const [horariosForm, setHorariosForm] = useState({});
  const [guardandoHorarios, setGuardandoHorarios] = useState(false);
  const [botonesForm, setBotonesForm] = useState([]);
  const [guardandoBotones, setGuardandoBotones] = useState(false);
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
    subcategoria: '', subcategoriaEn: '',
    descripcion: '', imagenUrl: '', disponible: true, tiempoMin: '', orden: '',
  };

  // Mismo patrón que urlInvitacion en PanelMaestro.jsx.
  const urlPortada = `${import.meta.env.VITE_BASE_URL || window.location.origin}/restaurante/${restauranteId}`;

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

  // El camino de respaldo (cuando crearPedido no está disponible y el
  // navegador escribe el pedido directo a Firestore, ver
  // pedidosRepository.js) nunca agrega a ventasDiarias — solo la Cloud
  // Function lo hace. Vista Día lee de `pedidos` directo (siempre exacta,
  // sin importar el camino), pero Semana/Mes leen de ventasDiarias, así que
  // un pedido de respaldo en el período queda fuera de esos totales sin
  // ningún aviso. mesaToken solo lo escribe el camino de respaldo (ver
  // pedidosRepository.js) — es la única marca disponible para detectarlo sin
  // tocar la Cloud Function ni el modelo de datos.
  const hayPedidosDeRespaldo = useMemo(
    () => vistaVentas !== 'dia' && pedidosReales.some((p) => p.mesaToken),
    [vistaVentas, pedidosReales]
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
      (p) => p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q) ||
        (p.subcategoria || '').toLowerCase().includes(q)
    );
  }, [platosOrdenados, busqueda]);

  // ─── Categorías/subcategorías (para autocompletar el form y la sección
  // de gestión más abajo) — misma fuente que Menu.jsx/Carta.jsx, así el
  // orden e imágenes configurados aquí coinciden exactamente con lo que
  // ve el cliente.
  const categoriasExistentes = useMemo(
    () => [...new Set(platos.map((p) => p.categoria).filter(Boolean))],
    [platos]
  );

  const subcategoriasExistentesDeCategoria = useMemo(() => {
    if (!form.categoria?.trim()) return [];
    const q = form.categoria.trim().toLowerCase();
    return [...new Set(
      platos.filter((p) => p.categoria?.toLowerCase() === q).map((p) => p.subcategoria).filter(Boolean)
    )];
  }, [platos, form.categoria]);

  const categoriasAdmin = useMemo(
    () => listarCategorias(platos, categoriasMeta),
    [platos, categoriasMeta]
  );

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
      .then(({
        acceso: ok, nombre, tiempos, impuestos, horaCierreOperativo: hc, horaCierreConfiguradaEn: hcFecha,
        marca, horarios, contacto, botones,
      }) => {
        if (!montadoRef.current) return;
        setAcceso(ok);
        if (ok) {
          setNombreRestaurante(nombre);
          setTiemposForm(tiempos);
          setImpuestosForm(impuestos);
          setHoraCierreOperativo(hc);
          // La dirección vivía en `contacto.direccion` (sistema anterior de
          // Contacto) — si `marca` todavía no tiene la suya, se migra al
          // vuelo (ver el guardado más abajo, después de setBotonesForm).
          const direccionCargada = marca.direccion || contacto.direccion || '';
          setMarcaForm({ logoUrl: marca.logoUrl || '', portadaUrl: marca.portadaUrl || '', eslogan: marca.eslogan || '', direccion: direccionCargada });
          // Los 7 días siempre presentes en el form, aunque el restaurante
          // todavía no haya configurado ninguno — así cada campo tiene un
          // valor controlado desde el primer render (nunca undefined).
          setHorariosForm(
            DIAS_SEMANA.reduce((acc, d) => ({ ...acc, [d]: { ...HORARIO_DIA_VACIO, ...(horarios[d] || {}) } }), {})
          );
          // Migración desde el sistema anterior: los botones creados cuando
          // los destinos se resolvían en vivo desde `contacto` tienen
          // `destino` vacío — se copian una sola vez, al cargar el panel.
          // Se persiste de inmediato (no solo en memoria) porque Portada.jsx
          // es pública y ya lee `boton.destino` directamente — si esto
          // quedara solo en memoria, esos botones se verían rotos ahí hasta
          // que alguien entrara a Admin y guardara a mano.
          const botonesCargados = botones.length > 0 ? botones : [];
          const { botones: botonesMigrados, cambio: botonesCambiaron } = migrarDestinosDesdeContacto(botonesCargados, contacto);
          setBotonesForm(botonesMigrados);
          if (botonesCambiaron) {
            guardarBotones(restauranteId, botonesMigrados).catch((e) => console.error('Error migrando destinos de botones:', e));
          }
          if (!marca.direccion && contacto.direccion) {
            guardarMarca(restauranteId, { logoUrl: marca.logoUrl || '', portadaUrl: marca.portadaUrl || '', eslogan: marca.eslogan || '', direccion: contacto.direccion })
              .catch((e) => console.error('Error migrando la dirección a Marca:', e));
          }
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

    const unsubPlatos = subscribePlatos(restauranteId, setPlatos);
    const unsubCategorias = subscribeCategorias(restauranteId, setCategoriasMeta);
    return () => {
      unsubPlatos();
      unsubCategorias();
    };
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

  // Evita crear un grupo nuevo por una diferencia de mayúsculas/espacios: si
  // el dueño escribe "cervezas" y ya existe "Cervezas", se guarda con la
  // capitalización ya existente en vez de crear un segundo grupo.
  function normalizarContraExistentes(valor, existentes) {
    const v = (valor || '').trim();
    if (!v) return v;
    const coincidencia = existentes.find((e) => e.toLowerCase() === v.toLowerCase());
    return coincidencia || v;
  }

  const guardar = async () => {
    if (!form.nombre || !form.precio || !form.categoria) {
      mostrarMensaje('Nombre, precio y categoría son obligatorios.', 'error');
      return;
    }
    setGuardando(true);
    try {
      const formNormalizado = {
        ...form,
        categoria: normalizarContraExistentes(form.categoria, categoriasExistentes),
        subcategoria: normalizarContraExistentes(form.subcategoria, subcategoriasExistentesDeCategoria),
      };
      await guardarPlato(restauranteId, formNormalizado, imagen, editandoId);
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
    // subcategoria/subcategoriaEn no existen en platos guardados antes de
    // esta función — sin el fallback, el input pasaría de no controlado
    // (undefined) a controlado apenas el dueño escribiera algo.
    setForm({ ...plato, subcategoria: plato.subcategoria || '', subcategoriaEn: plato.subcategoriaEn || '', orden: plato.orden ?? '' });
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

  // ── Categorías (imagen + orden de presentación) ─────────────────────────
  // El error de una subida NUNCA se queda solo en el toast de 3.5s
  // (mostrarMensaje) — también se guarda en categoriasError[slug] y se
  // muestra fijo junto al campo correspondiente, para que no dependa de que
  // el dueño esté mirando la pantalla justo en ese momento. "Subiendo…" da
  // señal de que sí pasó algo apenas se elige el archivo.
  const handleSubirImagenCategoria = async (slug, nombre, imagen) => {
    if (!imagen) return;
    setCategoriasSubiendo((s) => ({ ...s, [slug]: true }));
    setCategoriasError((er) => ({ ...er, [slug]: null }));
    try {
      await subirImagenCategoriaMeta(restauranteId, slug, imagen, { nombre, tipo: 'categoria' });
      if (montadoRef.current) {
        setCategoriaFileKeys((k) => ({ ...k, [slug]: (k[slug] || 0) + 1 }));
        mostrarMensaje('Imagen de categoría guardada.', 'ok');
      }
    } catch (e) {
      const mensaje = e.message === 'La imagen supera los 3MB.' ? e.message : 'No se pudo subir la imagen. Intenta de nuevo.';
      if (montadoRef.current) {
        setCategoriasError((er) => ({ ...er, [slug]: mensaje }));
        mostrarMensaje(mensaje, 'error');
      }
    } finally {
      if (montadoRef.current) setCategoriasSubiendo((s) => ({ ...s, [slug]: false }));
    }
  };

  const handleQuitarImagenCategoria = async (slug, nombre, imagenUrlActual) => {
    try {
      await quitarImagenCategoriaMeta(restauranteId, slug, imagenUrlActual, { nombre, tipo: 'categoria' });
      if (montadoRef.current) {
        setCategoriasError((er) => ({ ...er, [slug]: null }));
        mostrarMensaje('Imagen quitada.', 'ok');
      }
    } catch {
      if (montadoRef.current) {
        setCategoriasError((er) => ({ ...er, [slug]: 'No se pudo quitar la imagen. Intenta de nuevo.' }));
        mostrarMensaje('Error al quitar la imagen.', 'error');
      }
    }
  };

  const handleSubirImagenSubcategoria = async (slug, categoria, nombre, imagen) => {
    if (!imagen) return;
    setCategoriasSubiendo((s) => ({ ...s, [slug]: true }));
    setCategoriasError((er) => ({ ...er, [slug]: null }));
    try {
      await subirImagenCategoriaMeta(restauranteId, slug, imagen, { nombre, tipo: 'subcategoria', categoriaSlug: slugify(categoria) });
      if (montadoRef.current) {
        setCategoriaFileKeys((k) => ({ ...k, [slug]: (k[slug] || 0) + 1 }));
        mostrarMensaje('Imagen de subcategoría guardada.', 'ok');
      }
    } catch (e) {
      const mensaje = e.message === 'La imagen supera los 3MB.' ? e.message : 'No se pudo subir la imagen. Intenta de nuevo.';
      if (montadoRef.current) {
        setCategoriasError((er) => ({ ...er, [slug]: mensaje }));
        mostrarMensaje(mensaje, 'error');
      }
    } finally {
      if (montadoRef.current) setCategoriasSubiendo((s) => ({ ...s, [slug]: false }));
    }
  };

  const handleQuitarImagenSubcategoria = async (slug, categoria, nombre, imagenUrlActual) => {
    try {
      await quitarImagenCategoriaMeta(restauranteId, slug, imagenUrlActual, { nombre, tipo: 'subcategoria', categoriaSlug: slugify(categoria) });
      if (montadoRef.current) {
        setCategoriasError((er) => ({ ...er, [slug]: null }));
        mostrarMensaje('Imagen quitada.', 'ok');
      }
    } catch {
      if (montadoRef.current) {
        setCategoriasError((er) => ({ ...er, [slug]: 'No se pudo quitar la imagen. Intenta de nuevo.' }));
        mostrarMensaje('Error al quitar la imagen.', 'error');
      }
    }
  };

  // Reordenar reasigna `orden` secuencial (0,1,2…) a TODAS las categorías/
  // subcategorías de la lista, no solo a las dos movidas — así el orden
  // queda determinista para todas después del primer reordenamiento,
  // igual que ya hace handleMoverBoton con los botones de la portada.
  const moverCategoria = async (lista, index, direccion) => {
    const nuevoIdx = index + direccion;
    if (nuevoIdx < 0 || nuevoIdx >= lista.length) return;
    const reordenadas = [...lista];
    [reordenadas[index], reordenadas[nuevoIdx]] = [reordenadas[nuevoIdx], reordenadas[index]];
    try {
      await Promise.all(reordenadas.map((cat, i) =>
        guardarMetaCategoria(restauranteId, slugify(cat.nombre), { nombre: cat.nombre, tipo: 'categoria', orden: i })
      ));
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al reordenar categorías.', 'error');
    }
  };

  const moverSubcategoria = async (categoria, lista, index, direccion) => {
    const nuevoIdx = index + direccion;
    if (nuevoIdx < 0 || nuevoIdx >= lista.length) return;
    const reordenadas = [...lista];
    [reordenadas[index], reordenadas[nuevoIdx]] = [reordenadas[nuevoIdx], reordenadas[index]];
    try {
      await Promise.all(reordenadas.map((sub, i) =>
        guardarMetaCategoria(restauranteId, slugSubcategoria(categoria, sub.nombre), {
          nombre: sub.nombre, tipo: 'subcategoria', categoriaSlug: slugify(categoria), orden: i,
        })
      ));
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al reordenar subcategorías.', 'error');
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

  // ── Marca (logo, portada, eslogan) ──────────────────────────────────────
  const handleGuardarMarca = async () => {
    setSubiendoMarca(true);
    try {
      let logoUrl = marcaForm.logoUrl;
      let portadaUrl = marcaForm.portadaUrl;
      // Mismo patrón que guardarPlato: si hay un archivo nuevo, se sube y
      // comprime primero (subirImagenMarca ya valida el límite de 3MB).
      if (logoFile) logoUrl = await subirImagenMarca(logoFile, restauranteId, 'logo');
      if (portadaFile) portadaUrl = await subirImagenMarca(portadaFile, restauranteId, 'portada');
      const nuevaMarca = { logoUrl, portadaUrl, eslogan: marcaForm.eslogan || '', direccion: marcaForm.direccion || '' };
      await guardarMarca(restauranteId, nuevaMarca);
      if (!montadoRef.current) return;
      setMarcaForm(nuevaMarca);
      setLogoFile(null);
      setPortadaFile(null);
      mostrarMensaje('Marca guardada.', 'ok');
    } catch (e) {
      if (montadoRef.current) {
        mostrarMensaje(e.message === 'La imagen supera los 3MB.' ? e.message : 'Error al guardar la marca.', 'error');
      }
    } finally {
      if (montadoRef.current) setSubiendoMarca(false);
    }
  };

  // ── Horarios ─────────────────────────────────────────────────────────────
  const handleCambiarHorarioDia = (dia, campo, valor) => {
    setHorariosForm((prev) => ({ ...prev, [dia]: { ...prev[dia], [campo]: valor } }));
  };

  const handleAplicarATodos = (dia) => {
    const valorDia = horariosForm[dia];
    setHorariosForm((prev) =>
      DIAS_SEMANA.reduce((acc, d) => ({ ...acc, [d]: { ...valorDia } }), prev)
    );
  };

  const handleGuardarHorarios = async () => {
    // Validación mínima: si un día no está marcado cerrado, sus horas deben
    // tener formato válido — un horario a medio llenar rompería el cálculo
    // de apertura en la portada y en Menu.jsx.
    const invalido = DIAS_SEMANA.some((d) => {
      const h = horariosForm[d];
      if (h.cerrado) return false;
      const abreVacio = !h.abre, cierraVacio = !h.cierra;
      if (abreVacio && cierraVacio) return false; // día simplemente sin configurar, válido
      return abreVacio || cierraVacio; // solo una de las dos horas puesta — inválido
    });
    if (invalido) {
      mostrarMensaje('Cada día necesita hora de apertura Y cierre (o márcalo como cerrado).', 'error');
      return;
    }
    setGuardandoHorarios(true);
    try {
      // horaCierreOperativo va derivado de horariosForm — un solo write
      // atómico, así nunca quedan desincronizados (ver
      // derivarHoraCierreOperativo en utils/horarioRestaurante.js). El aviso
      // de discontinuidad (horaCierreConfiguradaEn) solo se reinicia cuando
      // el valor derivado REALMENTE cambia respecto al guardado.
      const horaCierreDerivado = derivarHoraCierreOperativo(horariosForm);
      const cambioDeCierre = horaCierreDerivado !== horaCierreOperativo;
      await guardarHorarios(restauranteId, horariosForm, horaCierreDerivado, cambioDeCierre);
      if (montadoRef.current) {
        setHoraCierreOperativo(horaCierreDerivado);
        if (cambioDeCierre) setHoraCierreConfiguradaEn(new Date()); // reflejo optimista de lo que se acaba de guardar
        mostrarMensaje('Horarios guardados.', 'ok');
      }
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al guardar los horarios.', 'error');
    } finally {
      if (montadoRef.current) setGuardandoHorarios(false);
    }
  };

  // ── Botones de la portada ────────────────────────────────────────────────
  // Cada botón lleva su propio destino — alta manual, como antes de la
  // sección de Contacto.
  const handleAgregarBoton = () => {
    setBotonesForm((prev) => [
      ...prev,
      { id: nuevoBotonId(), etiqueta: '', etiquetaEn: '', tipo: 'carta', destino: '', activo: true, orden: prev.length },
    ]);
  };

  const handleCambiarBoton = (id, campo, valor) => {
    setBotonesForm((prev) => prev.map((b) => (b.id === id ? { ...b, [campo]: valor } : b)));
  };

  const handleQuitarBoton = (id) => {
    setBotonesForm((prev) => prev.filter((b) => b.id !== id));
  };

  const handleMoverBoton = (id, direccion) => {
    setBotonesForm((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const nuevoIdx = idx + direccion;
      if (nuevoIdx < 0 || nuevoIdx >= prev.length) return prev;
      const copia = [...prev];
      [copia[idx], copia[nuevoIdx]] = [copia[nuevoIdx], copia[idx]];
      return copia.map((b, i) => ({ ...b, orden: i }));
    });
  };

  const handleGuardarBotones = async () => {
    // Un botón ACTIVO necesita un destino válido para su tipo — uno apagado
    // puede quedarse a medio llenar sin bloquear el guardado de los demás.
    const invalido = botonesForm.find((b) => b.activo && !destinoBotonValido(b.tipo, b.destino));
    if (invalido) {
      const etiqueta = invalido.etiqueta || TIPOS_BOTON.find((t) => t.tipo === invalido.tipo)?.label || 'Botón';
      mostrarMensaje(`"${etiqueta}" está activo pero no tiene un destino válido.`, 'error');
      return;
    }
    const botonesNormalizados = botonesForm.map((b, i) => ({
      ...b, orden: i, destino: normalizarDestinoBoton(b.tipo, b.destino),
    }));
    setGuardandoBotones(true);
    try {
      await guardarBotones(restauranteId, botonesNormalizados);
      if (montadoRef.current) {
        setBotonesForm(botonesNormalizados);
        mostrarMensaje('Botones guardados.', 'ok');
      }
    } catch {
      if (montadoRef.current) mostrarMensaje('Error al guardar los botones.', 'error');
    } finally {
      if (montadoRef.current) setGuardandoBotones(false);
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

  const copiarUrlPortada = async () => {
    try {
      await navigator.clipboard.writeText(urlPortada);
      if (montadoRef.current) mostrarMensaje('Enlace de la portada copiado.', 'ok');
    } catch {
      if (montadoRef.current) mostrarMensaje(urlPortada, 'ok');
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
            <p className="text-neutral-400 text-xs mt-1">Si lo dejas vacío, se mostrará el nombre en español.</p>
          </div>
          <input name="precio" placeholder="Precio *" type="number" value={form.precio} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <input name="categoria" list="categorias-existentes" placeholder="Categoría *" value={form.categoria} onChange={handleChange}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
          <datalist id="categorias-existentes">
            {categoriasExistentes.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div>
            <input name="categoriaEn" placeholder="Categoría en inglés (opcional)" value={form.categoriaEn} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
            <p className="text-neutral-400 text-xs mt-1">Si lo dejas vacío, se mostrará la categoría en español.</p>
          </div>
          <div>
            <input name="subcategoria" list="subcategorias-existentes" placeholder="Subcategoría (opcional)" value={form.subcategoria} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
            <datalist id="subcategorias-existentes">
              {subcategoriasExistentesDeCategoria.map((s) => <option key={s} value={s} />)}
            </datalist>
            <p className="text-neutral-400 text-xs mt-1">
              Úsala para agrupar dentro de una categoría. Ejemplo: en Bebidas, puedes tener Cervezas, Cócteles y Tragos.
            </p>
          </div>
          <div>
            <input name="subcategoriaEn" placeholder="Subcategoría en inglés (opcional)" value={form.subcategoriaEn} onChange={handleChange}
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
            <p className="text-neutral-400 text-xs mt-1">Si lo dejas vacío, se mostrará la subcategoría en español.</p>
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
            <p className="text-neutral-400 text-xs mt-1">Máximo 3MB</p>
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
                <p className="text-neutral-400 text-sm">
                  {p.categoria}{p.subcategoria ? ` › ${p.subcategoria}` : ''} — RD${p.precio}
                </p>
                {p.orden !== undefined && p.orden !== '' &&
                  <p className="text-neutral-400 text-xs">Orden: {p.orden}</p>}
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

        {/* ── Categorías ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Categorías</h2>
          <p className="text-neutral-500 text-xs mb-4">
            Ponle una imagen de fondo a cada categoría (y a sus subcategorías, si las usas) y ordénalas como
            quieras que aparezcan en el menú. Si no tocas nada aquí, todo sigue funcionando igual que hoy.
          </p>
          {categoriasAdmin.length === 0 ? (
            <p className="text-neutral-400 text-xs">Agrega platos primero — las categorías aparecen aquí solas.</p>
          ) : (
            <div className="space-y-5">
              {categoriasAdmin.map((cat, i) => {
                const slugCat = slugify(cat.nombre);
                const subcats = listarSubcategorias(platos, cat.nombre, categoriasMeta)
                  .filter((s) => typeof s.nombre === 'string');
                return (
                  <div key={cat.nombre} className="border border-neutral-800 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-semibold capitalize">{cat.nombre}</p>
                      <div className="flex gap-1">
                        <button onClick={() => moverCategoria(categoriasAdmin, i, -1)} disabled={i === 0}
                          className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-amber-400 disabled:opacity-30 min-h-[32px]">▲</button>
                        <button onClick={() => moverCategoria(categoriasAdmin, i, 1)} disabled={i === categoriasAdmin.length - 1}
                          className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-amber-400 disabled:opacity-30 min-h-[32px]">▼</button>
                      </div>
                    </div>
                    {cat.imagenUrl && (
                      <img src={cat.imagenUrl} alt="" className="w-full h-24 object-cover mb-2 border border-neutral-700" />
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <input key={categoriaFileKeys[slugCat] || 0} type="file" accept="image/*"
                        disabled={!!categoriasSubiendo[slugCat]}
                        onChange={(e) => handleSubirImagenCategoria(slugCat, cat.nombre, e.target.files[0])}
                        className="flex-1 min-w-[180px] bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400 text-sm disabled:opacity-50" />
                      {cat.imagenUrl && (
                        <button onClick={() => handleQuitarImagenCategoria(slugCat, cat.nombre, cat.imagenUrl)}
                          className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors min-h-[32px]">
                          Quitar
                        </button>
                      )}
                    </div>
                    {categoriasSubiendo[slugCat] && (
                      <p className="text-neutral-500 text-xs mt-1">Subiendo…</p>
                    )}
                    {categoriasError[slugCat] && (
                      <p className="text-red-400 text-xs mt-1">{categoriasError[slugCat]}</p>
                    )}

                    {subcats.length > 0 && (
                      <div className="mt-4 pl-4 border-l border-neutral-800 space-y-3">
                        <p className="text-neutral-500 text-xs tracking-widest uppercase">Subcategorías</p>
                        {subcats.map((sub, j) => {
                          const slugSub = slugSubcategoria(cat.nombre, sub.nombre);
                          return (
                            <div key={sub.nombre} className="border border-neutral-800 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm">{sub.nombre}</p>
                                <div className="flex gap-1">
                                  <button onClick={() => moverSubcategoria(cat.nombre, subcats, j, -1)} disabled={j === 0}
                                    className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-amber-400 disabled:opacity-30 min-h-[32px]">▲</button>
                                  <button onClick={() => moverSubcategoria(cat.nombre, subcats, j, 1)} disabled={j === subcats.length - 1}
                                    className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-amber-400 disabled:opacity-30 min-h-[32px]">▼</button>
                                </div>
                              </div>
                              {sub.imagenUrl && (
                                <img src={sub.imagenUrl} alt="" className="w-full h-20 object-cover mb-2 border border-neutral-700" />
                              )}
                              <div className="flex items-center gap-3 flex-wrap">
                                <input key={categoriaFileKeys[slugSub] || 0} type="file" accept="image/*"
                                  disabled={!!categoriasSubiendo[slugSub]}
                                  onChange={(e) => handleSubirImagenSubcategoria(slugSub, cat.nombre, sub.nombre, e.target.files[0])}
                                  className="flex-1 min-w-[180px] bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400 text-sm disabled:opacity-50" />
                                {sub.imagenUrl && (
                                  <button onClick={() => handleQuitarImagenSubcategoria(slugSub, cat.nombre, sub.nombre, sub.imagenUrl)}
                                    className="text-xs border border-neutral-600 text-neutral-400 px-3 py-1 hover:border-red-400 hover:text-red-400 transition-colors min-h-[32px]">
                                    Quitar
                                  </button>
                                )}
                              </div>
                              {categoriasSubiendo[slugSub] && (
                                <p className="text-neutral-500 text-xs mt-1">Subiendo…</p>
                              )}
                              {categoriasError[slugSub] && (
                                <p className="text-red-400 text-xs mt-1">{categoriasError[slugSub]}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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

        {/* ── Portada pública ── */}
        <div className="border border-neutral-800 p-6 mt-8">
          <h2 className="text-amber-400 text-xs tracking-widest uppercase mb-1">Tu enlace público</h2>
          <p className="text-neutral-500 text-xs mb-4">
            Compártelo en Instagram, WhatsApp o Google. Desde ahí tus clientes ven tu menú, tu horario y cómo llegar.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-neutral-400 text-xs font-mono truncate flex-1 min-w-0">{urlPortada}</span>
            <button onClick={copiarUrlPortada}
              className="text-xs border border-amber-400 text-amber-400 px-3 py-1 hover:bg-amber-400 hover:text-black transition-colors shrink-0 min-h-[32px]">
              Copiar enlace
            </button>
          </div>
          <a href={urlPortada} target="_blank" rel="noopener noreferrer"
            className="text-amber-400 text-xs hover:underline">
            Ver cómo se ve
          </a>

          {/* Marca */}
          <div className="border-t border-neutral-800 pt-5 mt-5">
            <h3 className="text-neutral-300 text-sm font-semibold mb-3">Marca</h3>
            <div className="space-y-3">
              <div>
                <label className="text-neutral-500 text-xs block mb-1">Logo</label>
                <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])}
                  className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400 text-base" />
                {marcaForm.logoUrl && !logoFile && (
                  <img src={marcaForm.logoUrl} alt="Logo actual" className="w-16 h-16 rounded-xl object-cover mt-2 border border-neutral-700" />
                )}
              </div>
              <div>
                <label className="text-neutral-500 text-xs block mb-1">Foto de portada (fondo)</label>
                <input type="file" accept="image/*" onChange={(e) => setPortadaFile(e.target.files[0])}
                  className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-400 focus:outline-none focus:border-amber-400 text-base" />
                {marcaForm.portadaUrl && !portadaFile && (
                  <img src={marcaForm.portadaUrl} alt="Portada actual" className="w-full max-w-xs h-24 object-cover mt-2 border border-neutral-700" />
                )}
                <p className="text-neutral-400 text-xs mt-1">Máximo 3MB. Sin foto, la portada usa un fondo oscuro sólido.</p>
              </div>
              <div>
                <label className="text-neutral-500 text-xs block mb-1">Eslogan</label>
                <input type="text" value={marcaForm.eslogan}
                  onChange={(e) => setMarcaForm((f) => ({ ...f, eslogan: e.target.value }))}
                  placeholder="Una experiencia de sabor, ritmo y esencia"
                  className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
              </div>
              <div>
                <label className="text-neutral-500 text-xs block mb-1">Dirección (se muestra en la portada)</label>
                <input type="text" value={marcaForm.direccion}
                  onChange={(e) => setMarcaForm((f) => ({ ...f, direccion: e.target.value }))}
                  placeholder="Calle, número, sector, ciudad"
                  className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 text-base" />
              </div>
            </div>
            <button onClick={handleGuardarMarca} disabled={subiendoMarca}
              className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 min-h-[44px]">
              {subiendoMarca ? 'Guardando...' : 'Guardar marca'}
            </button>
          </div>

          {/* Horarios */}
          <div className="border-t border-neutral-800 pt-5 mt-5">
            <h3 className="text-neutral-300 text-sm font-semibold mb-1">Horarios</h3>
            <p className="text-neutral-400 text-xs mb-3">
              Si cierras de madrugada, pon la hora de cierre del día siguiente (ej. abre 5:00 PM, cierra 2:00 AM).
              Deja un día sin horas para no restringir pedidos ese día.
            </p>
            <p className="text-neutral-400 text-xs mb-1">
              Si cierras después de medianoche, las ventas de la madrugada se contarán en el día anterior. Ejemplo:
              si cierras a las 2:00 AM, una venta del lunes a la 1:00 AM aparecerá en tu reporte del domingo.
            </p>
            <p className="text-neutral-500 text-xs mb-3">
              Tu día operativo termina a las {formatHoraAmPm(parsearHoraCierre(derivarHoraCierreOperativo(horariosForm)))}.
            </p>
            <div className="space-y-3">
              {DIAS_SEMANA.map((dia) => (
                <div key={dia} className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-400 text-xs w-20 shrink-0">{DIAS_SEMANA_LABEL[dia]}</span>
                  <input type="time" value={horariosForm[dia]?.abre || ''} disabled={horariosForm[dia]?.cerrado}
                    onChange={(e) => handleCambiarHorarioDia(dia, 'abre', e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 px-2 py-2 text-white text-base focus:outline-none focus:border-amber-400 disabled:opacity-40 w-28" />
                  <span className="text-neutral-400 text-xs">a</span>
                  <input type="time" value={horariosForm[dia]?.cierra || ''} disabled={horariosForm[dia]?.cerrado}
                    onChange={(e) => handleCambiarHorarioDia(dia, 'cierra', e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 px-2 py-2 text-white text-base focus:outline-none focus:border-amber-400 disabled:opacity-40 w-28" />
                  <label className="flex items-center gap-1 text-xs text-neutral-500 ml-1">
                    <input type="checkbox" checked={!!horariosForm[dia]?.cerrado}
                      onChange={(e) => handleCambiarHorarioDia(dia, 'cerrado', e.target.checked)} />
                    Cerrado
                  </label>
                  <button type="button" onClick={() => handleAplicarATodos(dia)}
                    className="text-xs text-neutral-400 hover:text-amber-400 transition-colors ml-auto">
                    Aplicar a todos
                  </button>
                </div>
              ))}
            </div>
            {DIAS_SEMANA.every((d) => horariosForm[d]?.cerrado) && (
              <div className="mt-3 border border-amber-800 bg-amber-950 text-amber-300 text-xs px-3 py-2">
                Estás marcando el restaurante como cerrado todos los días. No se
                podrán recibir pedidos hasta que abras algún día.
              </div>
            )}
            <button onClick={handleGuardarHorarios} disabled={guardandoHorarios}
              className="mt-4 bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 min-h-[44px]">
              {guardandoHorarios ? 'Guardando...' : 'Guardar horarios'}
            </button>
          </div>

          {/* Botones */}
          <div className="border-t border-neutral-800 pt-5 mt-5">
            <h3 className="text-neutral-300 text-sm font-semibold mb-1">Botones de la portada</h3>
            <p className="text-neutral-400 text-xs mb-3">
              Cada botón lleva su propio destino. Agrega los que quieras mostrar y llena a dónde debe llevar cada uno.
            </p>
            <div className="space-y-3">
              {botonesForm.map((b, i) => {
                const destinoInvalido = b.activo && !destinoBotonValido(b.tipo, b.destino);
                // La portada solo muestra un botón si tiene etiqueta en
                // español (ver Portada.jsx) — sin ella, el visitante en
                // español (el idioma por defecto) nunca lo ve, aunque esté
                // activo y su destino sea válido.
                const sinEtiqueta = b.activo && !(b.etiqueta || '').trim();
                return (
                  <div key={b.id} className="border border-neutral-800 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={b.tipo} onChange={(e) => handleCambiarBoton(b.id, 'tipo', e.target.value)}
                        className="bg-neutral-900 border border-neutral-700 px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-400">
                        {TIPOS_BOTON.map((tb) => <option key={tb.tipo} value={tb.tipo}>{tb.label}</option>)}
                      </select>
                      <div className="flex gap-1 ml-auto">
                        <button type="button" onClick={() => handleMoverBoton(b.id, -1)} disabled={i === 0}
                          className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-amber-400 disabled:opacity-30 min-h-[32px]">▲</button>
                        <button type="button" onClick={() => handleMoverBoton(b.id, 1)} disabled={i === botonesForm.length - 1}
                          className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-amber-400 disabled:opacity-30 min-h-[32px]">▼</button>
                        <button type="button" onClick={() => handleQuitarBoton(b.id)}
                          className="text-xs border border-neutral-700 text-neutral-400 px-2 py-1 hover:border-red-400 hover:text-red-400 min-h-[32px]">✕</button>
                      </div>
                    </div>
                    <div>
                      <input type="text" value={b.etiqueta} onChange={(e) => handleCambiarBoton(b.id, 'etiqueta', e.target.value)}
                        placeholder="Etiqueta en español"
                        className={`w-full bg-neutral-900 border px-3 py-2 text-white placeholder-neutral-500 text-base focus:outline-none ${
                          sinEtiqueta ? 'border-red-500' : 'border-neutral-700 focus:border-amber-400'}`} />
                      {sinEtiqueta && (
                        <p className="text-red-400 text-xs mt-1">Este botón está activo pero no tiene etiqueta en español — no se mostrará en la portada.</p>
                      )}
                    </div>
                    <input type="text" value={b.etiquetaEn} onChange={(e) => handleCambiarBoton(b.id, 'etiquetaEn', e.target.value)}
                      placeholder="Etiqueta en inglés (opcional)"
                      className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 text-base focus:outline-none focus:border-amber-400" />
                    {b.tipo !== 'carta' && (
                      <div>
                        <input type="text" value={b.destino} onChange={(e) => handleCambiarBoton(b.id, 'destino', e.target.value)}
                          placeholder={AYUDA_DESTINO[b.tipo] || 'Destino'}
                          className={`w-full bg-neutral-900 border px-3 py-2 text-white placeholder-neutral-500 text-base focus:outline-none ${
                            destinoInvalido ? 'border-red-500' : 'border-neutral-700 focus:border-amber-400'}`} />
                        {destinoInvalido && (
                          <p className="text-red-400 text-xs mt-1">Este botón está activo pero no tiene un destino válido — no se guardará así.</p>
                        )}
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs text-neutral-500">
                      <input type="checkbox" checked={b.activo} onChange={(e) => handleCambiarBoton(b.id, 'activo', e.target.checked)} />
                      Activo
                    </label>
                  </div>
                );
              })}
              {botonesForm.length === 0 && (
                <p className="text-neutral-400 text-xs">Sin botones todavía. Agrega los que quieras mostrar en tu portada.</p>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleAgregarBoton}
                className="border border-neutral-600 text-neutral-400 px-4 py-2 text-sm hover:border-amber-400 hover:text-amber-400 transition-colors min-h-[44px]">
                + Agregar botón
              </button>
              <button onClick={handleGuardarBotones} disabled={guardandoBotones}
                className="bg-amber-400 text-black px-6 py-2 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 min-h-[44px]">
                {guardandoBotones ? 'Guardando...' : 'Guardar botones'}
              </button>
            </div>
          </div>
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

          {/* Al menos un pedido del período se creó por el camino de respaldo
              (mesaToken presente) — esos pedidos no están sumados en el total
              de Semana/Mes (ver nota junto a hayPedidosDeRespaldo). */}
          {hayPedidosDeRespaldo && (
            <p className="text-amber-400 text-xs border border-amber-800 bg-amber-950 px-3 py-2 mb-4">
              Uno o más pedidos de este período se registraron en modo de respaldo (cuando el sistema
              principal no estaba disponible) y no están incluidos en este total — revisa el detalle de
              pedidos más abajo para verlos.
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
                    <span className="text-neutral-400 text-xs ml-2">{d.cantidad} pedido{d.cantidad !== 1 ? 's' : ''}</span>
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
            className="text-neutral-400 text-xs font-mono hover:text-amber-400 transition-colors break-all">
            {getUid()}
          </button>
          <p className="text-neutral-700 text-xs mt-1">Toca para copiar — compártelo con el maestro para que te asigne acceso</p>
        </div>

      </div>
    </div>
  );
}
