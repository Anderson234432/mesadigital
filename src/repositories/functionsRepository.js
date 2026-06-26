import { getApps } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

let _crearPedidoFn = null;

export function getCrearPedidoFn() {
  if (!_crearPedidoFn) {
    _crearPedidoFn = httpsCallable(getFunctions(getApps()[0]), 'crearPedido');
  }
  return _crearPedidoFn;
}
