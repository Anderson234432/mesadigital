import { useState, useEffect } from 'react';
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';

function Cocina() {
  const { restauranteId } = useParams();
  const [pedidos, setPedidos] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "restaurantes", restauranteId, "pedidos"), (snapshot) => {
      const datos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPedidos(datos);
    });
    return () => unsubscribe();
  }, []);

  async function marcarListo(id) {
    await updateDoc(doc(db, "restaurantes", restauranteId, "pedidos", id), { estado: 'listo' });
  }

  return (
    <div>
      <h1>Cocina</h1>
      {pedidos.map((pedido) => (
        <div key={pedido.id} style={{ border: '1px solid #ccc', margin: 10, padding: 10 }}>
          <strong>Mesa {pedido.mesa}</strong> — {pedido.estado}
          <ul>
            {pedido.items.map((item, i) => (
              <li key={i}>{item.nombre} - RD${item.precio}</li>
            ))}
          </ul>
          <p>Total: RD${pedido.total}</p>
          {pedido.estado === 'pendiente' && (
            <button onClick={() => marcarListo(pedido.id)}>Marcar como listo</button>
          )}
        </div>
      ))}
    </div>
  );
}

export default Cocina;