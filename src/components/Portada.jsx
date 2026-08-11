import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { t } from '../i18n';
import { subscribeRestaurante, obtenerNombreRestaurante } from '../services/restaurantesService';
import { calcularEstadoApertura, formatHora12 } from '../utils/horarioRestaurante';

// Portada pública "link en bio" — logo, nombre, píldora de apertura en vivo,
// y botones configurables. Es la página que alguien abre desde Instagram o
// Google, antes de decidir si va a ver la carta o pedir. Sin sesión anónima,
// sin nada del flujo de pedido — mismo patrón de detección de "no existe"
// que Carta.jsx (obtenerNombreRestaurante antes de montar la suscripción en
// vivo, sin tocar el contrato de subscribeRestaurante del que depende
// Menu.jsx).

function iconoBoton(tipo) {
  return { carta: '📖', mapa: '📍', whatsapp: '💬', instagram: '📷', telefono: '📞', enlace: '🔗' }[tipo] || '🔗';
}

function urlInstagram(valor) {
  if (!valor) return null;
  if (/^https?:\/\//i.test(valor)) return valor;
  return `https://instagram.com/${valor.replace(/^@/, '')}`;
}

// Cada botón lleva su propio destino (campo `destino`) — ya no existe una
// sección de Contacto centralizada de la que resolver en vivo. 'carta' es
// la única excepción: siempre va a la ruta de la carta, sin campo propio.
function resolverBoton(boton, restauranteId, nombre, lang) {
  switch (boton.tipo) {
    case 'carta':
      return { href: `/restaurante/${restauranteId}/carta`, externo: false };
    case 'mapa':
      return boton.destino ? { href: boton.destino, externo: true } : null;
    case 'whatsapp': {
      const numero = (boton.destino || '').replace(/\D/g, '');
      if (!numero) return null;
      const mensaje = encodeURIComponent(t[lang].whatsappMensajePredefinido(nombre));
      return { href: `https://wa.me/${numero}?text=${mensaje}`, externo: true };
    }
    case 'instagram': {
      const url = urlInstagram(boton.destino);
      return url ? { href: url, externo: true } : null;
    }
    case 'telefono':
      return boton.destino ? { href: `tel:${boton.destino}`, externo: false } : null;
    case 'enlace':
      return boton.destino ? { href: boton.destino, externo: true } : null;
    default:
      return null;
  }
}

function Portada() {
  const { restauranteId } = useParams();

  const [estadoCarga, setEstadoCarga] = useState('cargando'); // 'cargando' | 'no-existe' | 'listo'
  const [restaurante, setRestaurante] = useState(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('mesadigital_lang') || 'es';
    } catch {
      return 'es';
    }
  });

  useEffect(() => {
    let montado = true;
    obtenerNombreRestaurante(restauranteId)
      .then((nombre) => {
        if (!montado) return;
        setEstadoCarga(nombre === null ? 'no-existe' : 'listo');
      })
      .catch(() => { if (montado) setEstadoCarga('no-existe'); });
    return () => { montado = false; };
  }, [restauranteId]);

  useEffect(() => {
    if (estadoCarga !== 'listo') return;
    return subscribeRestaurante(restauranteId, setRestaurante);
  }, [estadoCarga, restauranteId]);

  // La píldora de apertura se recalcula sola cada minuto mientras la página
  // sigue abierta — mismo patrón de reloj que ya usa Cocina.jsx.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!restaurante?.nombre) return;
    document.title = t[lang].portadaTituloPagina(restaurante.nombre);
    const setMeta = (name, content, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    const descripcion = restaurante.marca?.eslogan || restaurante.nombre;
    setMeta('description', descripcion);
    setMeta('og:title', restaurante.nombre, 'property');
    setMeta('og:description', descripcion, 'property');
    setMeta('og:type', 'website', 'property');
    if (restaurante.marca?.portadaUrl) setMeta('og:image', restaurante.marca.portadaUrl, 'property');
  }, [restaurante, lang]);

  const estadoApertura = useMemo(
    () => calcularEstadoApertura(restaurante?.horarios, ahora),
    [restaurante, ahora]
  );

  const botonesActivos = useMemo(() => {
    if (!restaurante) return [];
    return [...(restaurante.botones || [])]
      .filter((b) => b.activo !== false)
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
      .map((b) => ({ ...b, resuelto: resolverBoton(b, restauranteId, restaurante.nombre, lang) }))
      .filter((b) => b.resuelto);
  }, [restaurante, restauranteId, lang]);

  const cambiarLang = (nuevoLang) => {
    setLang(nuevoLang);
    try { localStorage.setItem('mesadigital_lang', nuevoLang); } catch { /* no-op */ }
  };

  if (estadoCarga === 'cargando') return <div className="min-h-screen bg-neutral-950" />;

  if (estadoCarga === 'no-existe') {
    return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
        <div className="text-center px-6 max-w-sm">
          <p className="text-red-400 text-xs tracking-widest uppercase mb-2">404</p>
          <h1 className="text-2xl font-bold mb-4">{t[lang].cartaRestauranteNoExiste}</h1>
        </div>
      </div>
    );
  }

  const marca = restaurante?.marca || {};

  // Etiqueta de la píldora — un solo lugar que traduce el estado calculado a
  // texto, para no repetir la lógica de selección de mensaje en el JSX.
  let pillTexto = null;
  let pillColor = 'bg-neutral-500';
  if (estadoApertura?.abierto) {
    pillTexto = t[lang].pillAbierto(formatHora12(estadoApertura.horaCierra));
    pillColor = 'bg-green-500';
  } else if (estadoApertura?.categoria === 'abreHoy') {
    const h = Math.floor(estadoApertura.minutosFaltantes / 60);
    const m = estadoApertura.minutosFaltantes % 60;
    pillTexto = t[lang].pillAbreEn(h, m, formatHora12(estadoApertura.horaAbre));
    pillColor = 'bg-amber-400';
  } else if (estadoApertura?.categoria === 'otroDia') {
    pillTexto = estadoApertura.diasAdelante === 1
      ? t[lang].pillAbreManana(formatHora12(estadoApertura.horaAbre))
      : t[lang].pillAbreDia(t[lang].diasSemana[estadoApertura.nombreDiaApertura], formatHora12(estadoApertura.horaAbre));
    pillColor = 'bg-amber-400';
  } else if (estadoApertura?.categoria === 'cerradoHoy') {
    pillTexto = estadoApertura.diasAdelante === 1
      ? t[lang].pillCerradoHoyManana(formatHora12(estadoApertura.horaAbre))
      : t[lang].pillCerradoHoyDia(t[lang].diasSemana[estadoApertura.nombreDiaApertura], formatHora12(estadoApertura.horaAbre));
    pillColor = 'bg-neutral-500';
  } else if (estadoApertura?.categoria === 'sinProximaApertura') {
    pillTexto = t[lang].pillCerradoIndefinido;
    pillColor = 'bg-neutral-500';
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif relative overflow-hidden">
      {/* Fondo: portadaUrl a pantalla completa con capa oscura, o fondo sólido si no hay imagen */}
      <div className="fixed inset-0 -z-10">
        {marca.portadaUrl ? (
          <>
            <img src={marca.portadaUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/70" />
          </>
        ) : (
          <div className="w-full h-full" style={{ background: 'linear-gradient(to bottom, #1a0a00, #0a0a0a)' }} />
        )}
      </div>

      {/* Selector de idioma */}
      <div className="flex justify-end px-4 pt-3">
        <div className="inline-flex border border-neutral-700 rounded-full overflow-hidden bg-neutral-950/60">
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

      <div className="min-h-[85vh] flex flex-col items-center justify-center px-6 py-12 text-center">
        {marca.logoUrl && (
          <img src={marca.logoUrl} alt={restaurante?.nombre || ''}
            className="w-24 h-24 rounded-2xl object-cover mb-6 border border-neutral-700" />
        )}

        <h1 className="text-3xl font-bold tracking-wide mb-2">{restaurante?.nombre || ''}</h1>

        {marca.eslogan && (
          <p className="text-neutral-400 text-sm mb-5 max-w-xs">{marca.eslogan}</p>
        )}

        {marca.direccion && (
          <p className="text-neutral-500 text-xs mb-5 max-w-xs">📍 {marca.direccion}</p>
        )}

        {pillTexto && (
          <div className="inline-flex items-center gap-2 border border-neutral-700 bg-neutral-900/80 px-4 py-2 mb-8 text-xs font-bold tracking-widest">
            <span className={`w-2 h-2 rounded-full ${pillColor} shrink-0`} />
            {pillTexto}
          </div>
        )}

        <div className="w-full max-w-sm space-y-3">
          {botonesActivos.map((b) => {
            const etiqueta = (lang === 'en' && b.etiquetaEn?.trim()) || b.etiqueta;
            if (!etiqueta) return null;
            return (
              <a
                key={b.id}
                href={b.resuelto.href}
                target={b.resuelto.externo ? '_blank' : undefined}
                rel={b.resuelto.externo ? 'noreferrer' : undefined}
                className="w-full flex items-center justify-between border border-neutral-700 bg-neutral-900/80 px-5 py-4 hover:border-amber-400 hover:text-amber-400 transition-colors min-h-[44px]"
              >
                <span className="flex items-center gap-3">
                  <span>{iconoBoton(b.tipo)}</span>
                  <span className="font-semibold">{etiqueta}</span>
                </span>
                <span>→</span>
              </a>
            );
          })}
        </div>
      </div>

      <p className="text-center text-neutral-500 mb-8" style={{ fontSize: '12px' }}>
        {t[lang].creditoFooter}
      </p>
    </div>
  );
}

export default Portada;
