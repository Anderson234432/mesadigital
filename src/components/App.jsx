import { BrowserRouter, Routes, Route } from "react-router-dom";
import Menu from "./Menu";
import Admin from "./Admin";
import Cocina from "./Cocina";
import PanelMaestro from "./PanelMaestro";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/restaurante/:restauranteId/admin" element={<Admin />} />
<Route path="/restaurante/:restauranteId/mesa/:numeroMesa" element={<Menu />} />
<Route path="/restaurante/:restauranteId/cocina" element={<Cocina />} />
        <Route path="/maestro" element={<PanelMaestro />} />  
      </Routes>
    </BrowserRouter>
  );
}

export default App;