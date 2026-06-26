import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { suscribirEstadoAuth, esMaestro } from "../services/authService";

const Menu = lazy(() => import("./Menu"));
const Admin = lazy(() => import("./Admin"));
const Cocina = lazy(() => import("./Cocina"));
const PanelMaestro = lazy(() => import("./PanelMaestro"));
const Login = lazy(() => import("./Login"));

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

  useEffect(() => {
    return suscribirEstadoAuth((user) => {
      setUsuario(user);
      setCargando(false);
    });
  }, []);

  if (cargando) return <div className="min-h-screen bg-neutral-950" />;

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-neutral-950" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/restaurante/:restauranteId/menu/:numeroMesa" element={<Menu />} />
          <Route path="/restaurante/:restauranteId/admin" element={usuario ? <Admin /> : <Login />} />
          <Route path="/restaurante/:restauranteId/cocina" element={usuario ? <Cocina /> : <Login />} />
          <Route path="/maestro" element={
            !usuario ? <Login /> : esMaestro() ? <PanelMaestro /> : <Login />
          } />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
