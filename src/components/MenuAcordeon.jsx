import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { t } from '../i18n';
import {
  OTROS, listarCategorias, listarSubcategorias, mapaEtiquetas, filtrarPlatosDeVista,
} from '../utils/menuCategorias';

// Menú en acordeón — categorías (y sus subcategorías, si las tiene) se
// expanden en el mismo lugar en vez de navegar a otra pantalla. Componente
// compartido por Menu.jsx (flujo de pedido) y Carta.jsx (solo lectura) —
// antes cada uno duplicaba toda la lógica de agrupación/navegación; ahora
// ambos delegan aquí y solo difieren en cómo se ve un plato individual
// (`renderPlato`, con o sin controles de carrito) y si ocultan los agotados
// (`ocultarAgotados`). Toda la lógica de agrupación sigue viviendo en
// src/utils/menuCategorias.js, sin cambios — el modelo (categoría activa,
// subcategoría activa) es el mismo, solo cambia cómo se PRESENTA.
//
// Una sola categoría abierta a la vez, y dentro de ella una sola
// subcategoría a la vez — mismo criterio que la referencia
// (monoprieto.com): abrir dos secciones a la vez multiplica cuánto hay que
// desplazarse para volver a ver algo, justo lo que el acordeón busca evitar.
//
// Rendimiento: los platos de una categoría/subcategoría solo se MONTAN
// mientras está abierta (no se ocultan con CSS mientras siguen en el DOM) —
// con "una sola abierta a la vez" nunca hay más de un grupo de platos
// montado simultáneamente, así un menú con muchas categorías no paga el
// costo de renderizar todas sus fotos de una vez.
function usePrefersReducedMotion() {
  const [reducido, setReducido] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReducido(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reducido;
}

function Chevron({ abierta, pequena }) {
  return (
    <svg
      className={`${pequena ? 'w-4 h-4' : 'w-5 h-5'} shrink-0 transition-transform duration-200 motion-reduce:transition-none ${abierta ? 'rotate-180' : ''}`}
      viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z" />
    </svg>
  );
}

// Envoltorio grid-template-rows: 0fr↔1fr es la técnica estándar para animar
// una altura hacia "auto" con CSS puro (sin medir la altura en JS) — el
// contenido interno solo se monta cuando está abierto (ver comentario de
// rendimiento arriba), así que no hay "salto" visible: el contenido aparece
// ya dentro de una fila que está transicionando de 0fr a 1fr.
function Plegable({ abierta, children }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none ${abierta ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

export default function MenuAcordeon({ platos, categoriasMeta, lang, ocultarAgotados, renderPlato }) {
  const [categoriaAbierta, setCategoriaAbierta] = useState(null);
  const [subcategoriaAbierta, setSubcategoriaAbierta] = useState(null);
  const reducedMotion = usePrefersReducedMotion();
  const catRefs = useRef({});
  const subRefs = useRef({});

  const categorias = useMemo(() => listarCategorias(platos, categoriasMeta), [platos, categoriasMeta]);
  const categoriaEnMap = useMemo(() => mapaEtiquetas(platos, 'categoria', 'categoriaEn'), [platos]);
  const etiquetaCategoria = useCallback(
    (cat) => (lang === 'en' && categoriaEnMap[cat]) || cat,
    [lang, categoriaEnMap]
  );

  const subcategorias = useMemo(
    () => (categoriaAbierta ? listarSubcategorias(platos, categoriaAbierta, categoriasMeta) : []),
    [platos, categoriaAbierta, categoriasMeta]
  );
  const categoriaTieneSubcats = subcategorias.length > 0;

  const subcategoriaEnMap = useMemo(() => {
    if (!categoriaAbierta) return {};
    return mapaEtiquetas(platos.filter((p) => p.categoria === categoriaAbierta), 'subcategoria', 'subcategoriaEn');
  }, [platos, categoriaAbierta]);
  const etiquetaSubcategoria = useCallback(
    (sub) => (sub === OTROS ? t[lang].otros : (lang === 'en' && subcategoriaEnMap[sub]) || sub),
    [lang, subcategoriaEnMap]
  );

  // Solo tiene sentido calcular/montar platos cuando ya se sabe en qué
  // "hoja" está el usuario: categoría sin subcategorías (se muestran ya), o
  // categoría con subcategorías pero con una abierta.
  const platosDeVista = useMemo(() => {
    if (!categoriaAbierta) return [];
    if (categoriaTieneSubcats && !subcategoriaAbierta) return [];
    return filtrarPlatosDeVista(platos, categoriaAbierta, subcategoriaAbierta, ocultarAgotados);
  }, [platos, categoriaAbierta, subcategoriaAbierta, categoriaTieneSubcats, ocultarAgotados]);

  const toggleCategoria = (nombre) => {
    setCategoriaAbierta((actual) => (actual === nombre ? null : nombre));
    setSubcategoriaAbierta(null);
  };

  const toggleSubcategoria = (nombre) => {
    setSubcategoriaAbierta((actual) => (actual === nombre ? null : nombre));
  };

  // Si la tarjeta que se acaba de abrir queda fuera de la vista (arriba o
  // muy abajo), la trae a la vista — nunca deja al usuario sin saber qué
  // abrió. No se dispara al cerrar (solo importa cuando algo nuevo se abre).
  useEffect(() => {
    if (!categoriaAbierta) return;
    const el = catRefs.current[categoriaAbierta];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.3) {
      el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }, [categoriaAbierta, reducedMotion]);

  useEffect(() => {
    if (!subcategoriaAbierta) return;
    const clave = subcategoriaAbierta === OTROS ? '__otros__' : subcategoriaAbierta;
    const el = subRefs.current[clave];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.3) {
      el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }, [subcategoriaAbierta, reducedMotion]);

  return (
    <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
      {categorias.map((cat) => {
        const abierta = categoriaAbierta === cat.nombre;
        return (
          <div key={cat.nombre} ref={(el) => { catRefs.current[cat.nombre] = el; }}>
            <button onClick={() => toggleCategoria(cat.nombre)}
              className={`relative w-full h-28 border overflow-hidden text-left transition-colors ${
                abierta ? 'border-amber-400 border-2' : 'border-neutral-700 hover:border-amber-400'}`}>
              {cat.imagenUrl && (
                <img src={cat.imagenUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
              )}
              <div className={`absolute inset-0 transition-opacity ${abierta ? 'bg-black/30' : 'bg-black/50'}`} />
              <div className="relative z-10 flex items-center justify-between h-full px-6 gap-3">
                <span className="text-lg font-semibold capitalize">{etiquetaCategoria(cat.nombre)}</span>
                <Chevron abierta={abierta} />
              </div>
            </button>

            <Plegable abierta={abierta}>
              {abierta && (
                <div className="pt-3 pb-1 pl-3">
                  {categoriaTieneSubcats ? (
                    <div className="space-y-3">
                      {subcategorias.map((sub) => {
                        const subAbierta = subcategoriaAbierta === sub.nombre;
                        const clave = sub.nombre === OTROS ? '__otros__' : sub.nombre;
                        const tieneImagenPropia = !!sub.imagenUrl;
                        const imagenMostrada = sub.imagenUrl || cat.imagenUrl;
                        return (
                          <div key={clave} ref={(el) => { subRefs.current[clave] = el; }}>
                            <button onClick={() => toggleSubcategoria(sub.nombre)}
                              className={`relative w-full h-20 border overflow-hidden text-left transition-colors ${
                                subAbierta ? 'border-amber-400 border-2' : 'border-neutral-700 hover:border-amber-400'}`}>
                              {imagenMostrada && (
                                <img src={imagenMostrada} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                              )}
                              <div className={`absolute inset-0 transition-opacity ${
                                subAbierta ? 'bg-black/30' : tieneImagenPropia ? 'bg-black/50' : imagenMostrada ? 'bg-black/70' : 'bg-black/50'}`} />
                              <div className="relative z-10 flex items-center justify-between h-full px-5 gap-3">
                                <span className="font-semibold capitalize">{etiquetaSubcategoria(sub.nombre)}</span>
                                <Chevron abierta={subAbierta} pequena />
                              </div>
                            </button>
                            <Plegable abierta={subAbierta}>
                              {subAbierta && (
                                <div className="pt-4 pb-1 pl-2 space-y-4">
                                  {platosDeVista.map((plato) => renderPlato(plato))}
                                </div>
                              )}
                            </Plegable>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {platosDeVista.map((plato) => renderPlato(plato))}
                    </div>
                  )}
                </div>
              )}
            </Plegable>
          </div>
        );
      })}
    </div>
  );
}
