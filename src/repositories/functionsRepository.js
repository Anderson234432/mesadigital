import { getApps } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

let _crearPedidoFn = null;

export function getCrearPedidoFn() {
  if (!_crearPedidoFn) {
    _crearPedidoFn = httpsCallable(getFunctions(getApps()[0]), 'crearPedido');
  }
  return _crearPedidoFn;
}

let _canjearInvitacionFn = null;

export function getCanjearInvitacionFn() {
  if (!_canjearInvitacionFn) {
    _canjearInvitacionFn = httpsCallable(getFunctions(getApps()[0]), 'canjearInvitacion');
  }
  return _canjearInvitacionFn;
}

let _enviarCodigoInvitacionFn = null;

export function getEnviarCodigoInvitacionFn() {
  if (!_enviarCodigoInvitacionFn) {
    _enviarCodigoInvitacionFn = httpsCallable(getFunctions(getApps()[0]), 'enviarCodigoInvitacion');
  }
  return _enviarCodigoInvitacionFn;
}
