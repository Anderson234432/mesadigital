import { Component, useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { suscribirEstadoAuth, esMaestroAsync, esMaestroOriginal } from "../services/authService";

class ErrorBoundary extends Component {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err, info) { console.error('ErrorBoundary:', err, info); }
  render() {
    if (this.state.crashed) return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-red-400 text-xs tracking-widest uppercase mb-2">Error inesperado</p>
          <h1 className="text-2xl font-bold mb-4">Algo salió mal</h1>
          <p className="text-neutral-500 text-sm mb-6">Recarga la página para continuar.</p>
          <button onClick={() => window.location.reload()}
            className="text-xs border border-neutral-600 text-neutral-400 px-4 py-2 hover:border-amber-400 hover:text-amber-400 transition-colors">
            Recargar
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  if (online) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-950 border-b border-red-800 text-red-300 text-xs text-center py-2 tracking-wide">
      Sin conexión — tus pedidos no se enviarán hasta que vuelva la señal
    </div>
  );
}

const Menu = lazy(() => import("./Menu"));
const Admin = lazy(() => import("./Admin"));
const Cocina = lazy(() => import("./Cocina"));
const PanelMaestro = lazy(() => import("./PanelMaestro"));
const Login = lazy(() => import("./Login"));
const Invitacion = lazy(() => import("./Invitacion"));

function Landing() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
      <div className="text-center px-6 max-w-xs">
        <p className="text-amber-400 text-xs tracking-widest uppercase mb-6">Bienvenido a</p>
        <h1 className="text-5xl font-bold mb-6 tracking-wide">Mesa<span className="text-amber-400">Digital</span></h1>
        <div className="text-neutral-700 text-7xl mb-6 select-none">▢</div>
        <p className="text-neutral-500 text-sm leading-relaxed">
          Escanea el código QR de tu mesa para ver el menú y realizar tu pedido.
        </p>
      </div>
    </div>
  );
}

// Chequeo de maestro aislado en su propia ruta: requiere una lectura extra a
// Firestore (config/maestros, ver esMaestroAsync), y no debe frenar el
// arranque general de la app (menú del cliente, admin, cocina) para
// resolverlo — solo importa cuando alguien realmente navega a /maestro.
function RutaMaestro({ usuario }) {
  const [verificando, setVerificando] = useState(true);
  const [esMaestroActual, setEsMaestroActual] = useState(false);

  useEffect(() => {
    // El UID original no necesita el chequeo async — evita el viaje a
    // Firestore (y el parpadeo de carga) en el caso común del dueño real.
    if (!usuario || esMaestroOriginal()) return;
    let vivo = true;
    esMaestroAsync(usuario.uid)
      .then((res) => { if (vivo) setEsMaestroActual(res); })
      .catch(() => { if (vivo) setEsMaestroActual(false); })
      .finally(() => { if (vivo) setVerificando(false); });
    return () => { vivo = false; };
  }, [usuario]);

  if (!usuario) return <Login />;
  if (esMaestroOriginal()) return <PanelMaestro />;
  if (verificando) return <div className="min-h-screen bg-neutral-950" />;
  return esMaestroActual ? <PanelMaestro /> : <Login />;
}

function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
      <div className="text-center">
        <p className="text-amber-400 text-xs tracking-widest uppercase mb-2">Error 404</p>
        <h1 className="text-3xl font-bold mb-4">Página no encontrada</h1>
        <p className="text-neutral-500 text-sm">La ruta que buscas no existe.</p>
      </div>
    </div>
  );
}

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tardandoMucho, setTardandoMucho] = useState(false);

  useEffect(() => {
    return suscribirEstadoAuth((user) => {
      setUsuario(user);
      setCargando(false);
    });
  }, []);

  // Si Firebase Auth nunca responde (servicio caído, red bloqueada por un
  // firewall/proxy corporativo, etc.), suscribirEstadoAuth no dispara nunca
  // y `cargando` se queda en true para siempre — sin esto, el cliente ve una
  // pantalla en blanco indefinida sin ninguna pista de qué pasó.
  useEffect(() => {
    if (!cargando) return;
    const id = setTimeout(() => setTardandoMucho(true), 8000);
    return () => clearTimeout(id);
  }, [cargando]);

  if (cargando) {
    if (tardandoMucho) {
      return (
        <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
          <div className="text-center px-6">
            <p className="text-red-400 text-xs tracking-widest uppercase mb-2">Sin conexión con el servidor</p>
            <h1 className="text-2xl font-bold mb-4">Esto está tardando más de lo normal</h1>
            <p className="text-neutral-500 text-sm mb-6">Verifica tu conexión e intenta de nuevo.</p>
            <button onClick={() => window.location.reload()}
              className="text-xs border border-neutral-600 text-neutral-400 px-4 py-2 hover:border-amber-400 hover:text-amber-400 transition-colors">
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return <div className="min-h-screen bg-neutral-950" />;
  }

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <OfflineBanner />
        <Suspense fallback={<div className="min-h-screen bg-neutral-950" />}>
          <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/invitacion/:token" element={<Invitacion />} />
          <Route path="/restaurante/:restauranteId/menu/:numeroMesa" element={<Menu />} />
          <Route path="/restaurante/:restauranteId/admin" element={usuario ? <Admin /> : <Login />} />
          <Route path="/restaurante/:restauranteId/cocina" element={usuario ? <Cocina /> : <Login />} />
          <Route path="/maestro" element={<RutaMaestro usuario={usuario} />} />
          <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
