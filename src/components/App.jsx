import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";

const Menu = lazy(() => import("./Menu"));
const Admin = lazy(() => import("./Admin"));
const Cocina = lazy(() => import("./Cocina"));
const PanelMaestro = lazy(() => import("./PanelMaestro"));
const Login = lazy(() => import("./Login"));

const MAESTRO_UID = "xB7aybhKvYhIkuq7TERTuMfUkaH2";

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCargando(false);
    });
    return unsub;
  }, []);

  if (cargando) return <div className="min-h-screen bg-neutral-950" />;

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-neutral-950" />}>
        <Routes>
          <Route path="/restaurante/:restauranteId/menu/:numeroMesa" element={<Menu />} />
          <Route path="/restaurante/:restauranteId/admin" element={usuario ? <Admin /> : <Login />} />
          <Route path="/restaurante/:restauranteId/cocina" element={usuario ? <Cocina /> : <Login />} />
          <Route path="/maestro" element={
            !usuario ? <Login /> : usuario.uid === MAESTRO_UID ? <PanelMaestro /> : <Login />
          } />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;