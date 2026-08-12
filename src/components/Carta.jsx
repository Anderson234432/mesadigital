import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { t } from '../i18n';
import { subscribeRestaurante, obtenerNombreRestaurante } from '../services/restaurantesService';
import { subscribePlatos } from '../services/platosService';
import { subscribeCategorias } from '../services/categoriasService';
import { buscarPlatos } from '../utils/menuCategorias';
import MenuAcordeon from './MenuAcordeon';

// Carta pública de solo lectura — sin carrito, sin sesión anónima, sin nada del
// flujo de pedido. Reutiliza exactamente los mismos servicios que Menu.jsx
// (subscribeRestaurante, subscribePlatos) para no duplicar ninguna lógica de
// negocio; lo único propio de este archivo es cómo se PRESENTA esa data — sin
// carrito, agrupación de mesa, ni idempotencia, nada de eso aplica aquí.
//
// Detección de "restaurante no existe": subscribeRestaurante (ver
// restaurantesService.js) nunca llama a su callback si el documento no
// existe — Menu.jsx depende de ese comportamiento (silencio = mantener el
// último estado conocido) y no se toca. En vez de cambiarlo, esta pantalla
// hace una lectura puntual con obtenerNombreRestaurante (ya existente, usada
// también por Invitacion.jsx) ANTES de montar la suscripción en vivo — esa
// función sí devuelve null cuando el documento no existe.

const CartaPlatoItem = ({ plato, nombreMostrado, agotadoLabel }) => {
  const agotado = plato.disponible === false;
  return (
    <div className={`border-b border-neutral-800 pb-4 ${agotado ? 'opacity-50' : ''}`}>
      {plato.imagenUrl && (
        <img
          src={plato.imagenUrl}
          alt={nombreMostrado}
          loading="lazy"
          className="w-full object-contain mb-3 max-h-64"
        />
      )}
      <div className="flex justify-between items-start gap-3">
        <div>
          <p className="text-lg font-semibold">{nombreMostrado}</p>
          {plato.descripcion && <p className="text-neutral-400 text-sm">{plato.descripcion}</p>}
          <p className="text-amber-400 mt-1">RD${plato.precio}</p>
        </div>
        {agotado && (
          <span className="shrink-0 text-xs tracking-widest uppercase border border-neutral-600 text-neutral-400 px-2 py-1">
            {agotadoLabel}
          </span>
        )}
      </div>
    </div>
  );
};

function Carta() {
  const { restauranteId } = useParams();

  const [estado, setEstado] = useState('cargando'); // 'cargando' | 'no-existe' | 'listo'
  const [restaurante, setRestaurante] = useState(null);
  const [platos, setPlatos] = useState([]);
  const [categoriasMeta, setCategoriasMeta] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('mesadigital_lang') || 'es';
    } catch {
      return 'es';
    }
  });

  // Existencia primero (lectura puntual), suscripciones en vivo después —
  // así el precio/disponibilidad se actualiza solo mientras alguien tiene la
  // carta abierta, sin necesitar una sesión anónima para lograrlo.
  useEffect(() => {
    let montado = true;
    obtenerNombreRestaurante(restauranteId)
      .then((nombre) => {
        if (!montado) return;
        setEstado(nombre === null ? 'no-existe' : 'listo');
      })
      .catch(() => { if (montado) setEstado('no-existe'); });
    return () => { montado = false; };
  }, [restauranteId]);

  useEffect(() => {
    if (estado !== 'listo') return;
    const unsubRestaurante = subscribeRestaurante(restauranteId, setRestaurante);
    const unsubPlatos = subscribePlatos(restauranteId, setPlatos);
    const unsubCategorias = subscribeCategorias(restauranteId, setCategoriasMeta);
    return () => {
      unsubRestaurante();
      unsubPlatos();
      unsubCategorias();
    };
  }, [estado, restauranteId]);

  // Título de pestaña + meta tags para quien SÍ ejecuta JS (navegadores
  // normales). Los bots de redes sociales no ejecutan JavaScript — de eso se
  // encarga api/carta-meta.js del lado del servidor, ver ese archivo.
  useEffect(() => {
    if (!restaurante?.nombre) return;
    document.title = t[lang].cartaTituloPagina(restaurante.nombre);
    const setMeta = (name, content, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    setMeta('description', `Menú de ${restaurante.nombre}: platos, fotos y precios.`);
    setMeta('og:title', document.title, 'property');
    setMeta('og:description', `Menú de ${restaurante.nombre}: platos, fotos y precios.`, 'property');
    setMeta('og:type', 'website', 'property');
  }, [restaurante, lang]);

  const nombrePlato = useCallback(
    (plato) => (lang === 'en' && plato.nombreEn?.trim()) || plato.nombre,
    [lang]
  );

  // A diferencia de Menu.jsx (que oculta los platos agotados porque no se
  // pueden pedir), la carta SÍ los muestra, marcados — es una carta para
  // decidir si ir o para curiosear desde redes, no para pedir ahora mismo.
  // Ocultarlos daría una carta "más limpia" pero menos honesta: alguien
  // podría pensar que el restaurante nunca tiene ese plato, cuando solo se
  // agotó hoy. Por eso ocultarAgotados=false abajo (búsqueda y acordeón).
  const resultadosBusqueda = useMemo(
    () => buscarPlatos(platos, busqueda, false),
    [platos, busqueda]
  );

  const renderPlato = useCallback((plato) => (
    <CartaPlatoItem key={plato.id} plato={plato} nombreMostrado={nombrePlato(plato)} agotadoLabel={t[lang].agotado} />
  ), [nombrePlato, lang]);

  const impuestosConfig = restaurante?.impuestos || {};
  const cambiarLang = (nuevoLang) => {
    setLang(nuevoLang);
    try { localStorage.setItem('mesadigital_lang', nuevoLang); } catch { /* no-op */ }
  };

  if (estado === 'cargando') return <div className="min-h-screen bg-neutral-950" />;

  if (estado === 'no-existe') {
    return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
        <div className="text-center px-6 max-w-sm">
          <p className="text-red-400 text-xs tracking-widest uppercase mb-2">404</p>
          <h1 className="text-2xl font-bold mb-4">{t[lang].cartaRestauranteNoExiste}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif">

      {/* Selector de idioma */}
      <div className="flex justify-end px-4 pt-3 bg-neutral-950">
        <div className="inline-flex border border-neutral-700 rounded-full overflow-hidden">
          <button onClick={() => cambiarLang('es')}
            className={`px-3 py-1 text-xs font-bold tracking-widest transition-colors ${
              lang === 'es' ? 'bg-amber-400 text-black' : 'text-neutral-400 hover:text-white'
            }`}>
            ES
          </button>
          <button onClick={() => cambiarLang('en')}
            className={`px-3 py-1 text-xs font-bold tracking-widest transition-colors ${
              lang === 'en' ? 'bg-amber-400 text-black' : 'text-neutral-400 hover:text-white'
            }`}>
            EN
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="relative h-48 flex items-end justify-center pb-6"
        style={{ background: 'linear-gradient(to bottom, #1a0a00, #0a0a0a)' }}>
        <div className="text-center">
          <p className="text-amber-400 text-sm tracking-widest uppercase">{t[lang].bienvenido}</p>
          <h1 className="text-3xl font-bold tracking-wide">{restaurante?.nombre || ''}</h1>
        </div>
      </div>

      {/* Buscador */}
      <div className="max-w-lg mx-auto px-4 pt-6 pb-2">
        <div className="relative">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t[lang].buscarPlaceholder}
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

      {/* Aviso de impuestos */}
      {(impuestosConfig.itbisActivo || impuestosConfig.propinaActivo) && (
        <p className="max-w-lg mx-auto px-4 text-neutral-600 text-xs mb-2">{t[lang].preciosSinImpuestos}</p>
      )}

      {/* Resultados de búsqueda / Categorías / Lista de platos */}
      {platos.length === 0 ? (
        <p className="text-neutral-500 text-sm text-center py-16 px-6">{t[lang].cartaSinPlatos}</p>
      ) : busqueda.trim() ? (
        <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
          {resultadosBusqueda.length === 0 ? (
            <p className="text-neutral-500 text-sm text-center py-8">{t[lang].sinResultadosPara} "{busqueda}"</p>
          ) : (
            resultadosBusqueda.map((plato) => (
              <CartaPlatoItem key={plato.id} plato={plato} nombreMostrado={nombrePlato(plato)} agotadoLabel={t[lang].agotado} />
            ))
          )}
        </div>
      ) : (
        <MenuAcordeon
          platos={platos}
          categoriasMeta={categoriasMeta}
          lang={lang}
          ocultarAgotados={false}
          renderPlato={renderPlato}
        />
      )}

      {/* Llamado a la acción */}
      <div className="max-w-lg mx-auto px-6 py-10 mt-4 border-t border-neutral-800 text-center">
        <p className="text-neutral-400 text-sm leading-relaxed">{t[lang].cartaLlamadoAccion}</p>
      </div>

      <p className="text-center text-neutral-600 mt-2 mb-10" style={{ fontSize: '12px' }}>
        {t[lang].creditoFooter}
      </p>

    </div>
  );
}

export default Carta;
