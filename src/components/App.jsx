import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import Menu from "./Menu";
import Admin from "./Admin";
import Cocina from "./Cocina";
import PanelMaestro from "./PanelMaestro";
import Login from "./Login";

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
      <Routes>
        <Route path="/restaurante/:restauranteId/menu/:numeroMesa" element={<Menu />} />
        <Route path="/restaurante/:restauranteId/admin" element={usuario ? <Admin /> : <Login />} />
        <Route path="/restaurante/:restauranteId/cocina" element={usuario ? <Cocina /> : <Login />} />
        <Route path="/maestro" element={usuario ? <PanelMaestro /> : <Login />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;