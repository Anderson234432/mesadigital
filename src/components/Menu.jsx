import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';

function Menu() {
  const { restauranteId, numeroMesa } = useParams();
  const [platos, setPlatos] = useState([]);
  const [carrito, setCarrito] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "restaurantes", restauranteId, "platos"), (snapshot) => {
      const datos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setPlatos(datos);
    });

    return () => unsubscribe();
  }, []);

  function agregarAlCarrito(plato) {
    setCarrito([...carrito, plato]);
  }

  const total = carrito.reduce((suma, item) => suma + item.precio, 0);

  async function enviarPedido() {
    if (carrito.length === 0) return;

    await addDoc(collection(db, "restaurantes", restauranteId, "pedidos"), {
      mesa: numeroMesa,
      items: carrito.map((p) => ({ nombre: p.nombre, precio: p.precio })),
      total: total,
      estado: 'pendiente',
      creadoEn: serverTimestamp(),
    });

    setCarrito([]);
    alert(`Pedido enviado desde Mesa ${numeroMesa}`);
  }

  return (
    <div>
      <h1>MesaDigital — Mesa {numeroMesa}</h1>
      <ul>
        {platos.map((plato) => (
          <li key={plato.id}>
            {plato.nombre} - RD${plato.precio}
            <button onClick={() => agregarAlCarrito(plato)}>Agregar</button>
          </li>
        ))}
      </ul>
      <h3>Tu pedido:</h3>
      <ul>
        {carrito.map((item, index) => (
          <li key={index}>{item.nombre} - RD${item.precio}</li>
        ))}
      </ul>
      <p>Total: RD${total}</p>
      <button onClick={enviarPedido}>Enviar pedido</button>
    </div>
  );
}

export default Menu;