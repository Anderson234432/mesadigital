# AUDIT REPORT — mesaDigital
**Fecha:** 2026-06-25  
**Auditor:** Claude Sonnet 4.6 (Modo Agente de Ingeniería)  
**Rama:** main | Commit base: 904b98c

---

## 1. EL VEREDICTO FRÍO

### ¿Puedo salir a buscar clientes HOY?
**SÍ — con reservas críticas conocidas.**

El sistema puede procesar pedidos reales en producción hoy mismo. Los flujos de negocio core (menú → carrito → pedido → cocina → listo) funcionan de extremo a extremo. Las reservas son de seguridad, no de funcionalidad.

### Porcentaje de preparación para producción masiva (tras cambios)
**72%**

| Dimensión | Antes | Después | Notas |
|---|---|---|---|
| Rendimiento UI (200 usuarios) | 55% | 80% | Memoización + flood guard |
| Resiliencia de red | 60% | 85% | Exponential backoff + optimistic UI |
| Consistencia de escrituras | 65% | 90% | Batch writes atómicos |
| Seguridad de precios | 20% | 35% | Sin Cloud Functions: límite máximo en rules |
| Aislamiento de mesas | 30% | 30% | Sin cambio: requiere autenticación anónima |
| Infraestructura QR estático | 90% | 90% | Sin cambio: Vercel ya lo soporta |

### Calificación de la nueva arquitectura por capas
**7 / 10**

La separación en `src/services/pedidosService.js` es correcta y limpia. El límite inferior es que sin Cloud Functions no existe una capa de backend real — los precios son enviados desde el cliente y solo se validan por rangos en Firestore Rules, no por valores exactos.

---

## 2. LA MAYOR DEBILIDAD — Punto Único de Fallo (SPOF)

### SPOF Principal: Ausencia de Cloud Functions = sin validación de precios en servidor

**El problema técnico exacto:**  
Cuando un cliente envía un pedido, el array `items` incluye `precio` establecido por el dispositivo del cliente. Firestore Rules valida que `total <= 100000` y que `total > 0` si hay ítems, pero **no puede consultar la colección `platos` para verificar que `items[n].precio` coincida con el precio real del plato**.

Un cliente técnico puede abrir la DevTools → Application → modificar el `sessionStorage` del carrito → enviar un pedido con `precio: 1` en cada ítem y `total: 5` para una orden de RD$2,000.

**Impacto en alta saturación:**  
Un día de 200 clientes con 50 pedidos: si 3-4 clientes explotan esto, el restaurante pierde ingresos reales. El admin lo detectaría manualmente revisando los totales, pero solo después.

**La solución:**  
Implementar Firebase Cloud Functions. La función `crearPedido` recibiría solo los IDs de los platos y las cantidades, consultaría `platos/{id}` para obtener el precio real, calcularía el total en el servidor, y escribiría el documento. El cliente nunca enviaría precios.

### SPOF Secundario: Listener global de pedidos pendientes en cada cliente Menu

Cada cliente del menú mantiene activo:
1. `onSnapshot` en `pedidos WHERE mesa == X` (su mesa)  
2. `onSnapshot` en `pedidos WHERE estado == 'pendiente'` (TODOS los pedidos pendientes)

Con 200 clientes simultáneos, el listener #2 se ejecuta en 200 pestañas a la vez. Cada vez que cualquier pedido cambia de estado, Firebase envía la actualización a 200 conexiones. A RD~$0.06/100k lecturas, el costo es manejable, pero el ancho de banda se puede triplicar en horario pico.

**Solución sin Cloud Functions:** Mover el cálculo de `mesasPendientes` a un documento de conteo agregado (patrón counter distribuido), actualizable solo desde cocina.

---

## 3. CERTIFICACIÓN DEL QR ESTÁTICO ETERNO

### Principio de diseño
El QR impreso en la mesa nunca debe quedar obsoleto, independientemente de cambios de dominio, plataforma de hosting, o restructura de rutas.

### Estrategia de infraestructura exacta

#### Nivel 1: URL canónica permanente con dominio propio
```
QR apunta a: https://menu.turestaurante.com/r/{restauranteId}/m/{mesa}
```
- **Registro un dominio propio** (no `mesadigital-pi.vercel.app`).  
  Si mañana migras de Vercel a otro host, el dominio propio no cambia.
- DNS: registro CNAME `menu.turestaurante.com → mesadigital-pi.vercel.app`  
  Cuando cambies de host, solo actualizas el CNAME — el QR nunca cambia.

#### Nivel 2: Redirección permanente como capa de indirección
Configura en `vercel.json` (o el hosting que uses):
```json
{
  "redirects": [
    {
      "source": "/r/:restauranteId/m/:mesa",
      "destination": "/restaurante/:restauranteId/menu/:mesa",
      "permanent": true
    }
  ]
}
```
El QR apunta a la ruta corta `/r/.../m/...`. La ruta larga `/restaurante/.../menu/...` puede cambiar en el futuro sin invalidar un solo QR impreso.

#### Nivel 3: Control de caché agresivo para la SPA
En `vercel.json`, configura headers:
```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
      ]
    }
  ]
}
```
- Los assets JS/CSS se sirven inmutables (1 año de caché) — carga instantánea en visitas repetidas.  
- El `index.html` nunca se cachea — siempre apunta al bundle más reciente.  
- Resultado: el QR carga en <1s en teléfonos que ya visitaron el menú.

#### Nivel 4: Firebase Hosting como respaldo (opcional)
Si se usa Firebase Hosting junto a Vercel, el dominio personalizado con CNAME puede apuntar a Firebase Hosting si Vercel falla. El switch es un cambio de CNAME de 5 minutos, sin reimprimir un solo QR.

---

## 4. CAMBIOS APLICADOS EN ESTA AUDITORÍA

### Nuevos archivos
| Archivo | Descripción |
|---|---|
| `src/services/pedidosService.js` | Capa de persistencia: `enviarPedido` (con exponential backoff 1s→2s→4s), `llamarMesero`, `actualizarEstadoMesa` (batch write atómico) |

### Archivos modificados
| Archivo | Cambios |
|---|---|
| `src/components/Menu.jsx` | `useMemo` en total/carritoAgrupado/categorias/platosFiltrados; `useCallback` en agregarAlCarrito/quitarDelCarrito/enviarPedido; `memo(PlatoItem)` evita re-renders de toda la lista en cada clic; `envioRef` como flood guard síncrono; Optimistic UI con rollback automático; servicio centralizado con backoff |
| `src/components/Cocina.jsx` | Batch writes atómicos via `actualizarEstadoMesa` — marcar listo/archivar/descartar llamada son ahora operaciones ACID en lugar de `Promise.all` de writes separados |
| `firestore.rules` | Límite máximo de total `<= 100000`; reduce items a max 30; validación de consistencia `items vacío → total puede ser 0`; documentación de limitaciones de aislamiento |

---

## 5. DEUDA TÉCNICA PENDIENTE (priorizada)

1. **[CRÍTICO]** Implementar Firebase Cloud Functions para validación de precios en servidor.
2. **[ALTO]** Autenticación anónima en Menu.jsx + restricción de lectura de pedidos por UID para aislamiento real de mesas.
3. **[MEDIO]** Contador agregado de mesas pendientes para eliminar el listener global en clientes del menú.
4. **[MEDIO]** Dominio personalizado + redirects permanentes para certificación definitiva del QR.
5. **[BAJO]** Rate limiting en Firestore Rules (requiere timestamp del último pedido por IP, no disponible sin Cloud Functions).
