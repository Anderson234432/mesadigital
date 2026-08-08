import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { validarInvitacion, enviarCodigoInvitacion, canjearInvitacion } from '../services/invitacionesService';
import { obtenerNombreRestaurante } from '../services/restaurantesService';

const MOTIVO_MENSAJE = {
  'no-existe': 'Este enlace de invitación no es válido.',
  revocada: 'Esta invitación fue revocada. Pide una nueva.',
  usada: 'Esta invitación ya fue usada. Si crees que es un error, pide una nueva.',
  vencida: 'Esta invitación venció. Pide una nueva.',
};

const REENVIO_COOLDOWN_S = 60;

function Invitacion() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [cargando, setCargando] = useState(true);
  const [invitacion, setInvitacion] = useState(null); // { restauranteId, rol, nombreRestaurante }
  const [motivoInvalida, setMotivoInvalida] = useState('');

  // 'email' — pedir el correo y enviar el código. 'codigo' — código + contraseña.
  const [paso, setPaso] = useState('email');

  const [email, setEmail] = useState('');
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [errorEmail, setErrorEmail] = useState('');

  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [errorCodigo, setErrorCodigo] = useState('');
  const [creandoCuenta, setCreandoCuenta] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const codigoInputRef = useRef(null);

  useEffect(() => {
    let montado = true;
    validarInvitacion(token)
      .then(async (resultado) => {
        if (!montado) return;
        if (!resultado.valida) {
          setMotivoInvalida(resultado.motivo);
          setCargando(false);
          return;
        }
        const nombreRestaurante = await obtenerNombreRestaurante(resultado.restauranteId);
        if (!montado) return;
        setInvitacion({ restauranteId: resultado.restauranteId, rol: resultado.rol, nombreRestaurante });
        setCargando(false);
      })
      .catch(() => {
        if (!montado) return;
        setMotivoInvalida('no-existe');
        setCargando(false);
      });
    return () => { montado = false; };
  }, [token]);

  // ─── Cuenta regresiva del reenvío ────────────────────────────
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (paso === 'codigo') codigoInputRef.current?.focus();
  }, [paso]);

  async function enviarCodigo(correo) {
    setEnviandoCodigo(true);
    setErrorEmail('');
    try {
      await enviarCodigoInvitacion({ token, email: correo });
      setPaso('codigo');
      setCooldown(REENVIO_COOLDOWN_S);
    } catch (e) {
      // El mensaje real (correo ya registrado, invitación inválida, etc.) viene
      // de la Cloud Function — no se oculta detrás de un texto genérico.
      setErrorEmail(e?.message || 'No se pudo enviar el código. Intenta de nuevo.');
    } finally {
      setEnviandoCodigo(false);
    }
  }

  function handleSubmitEmail(e) {
    e.preventDefault();
    if (enviandoCodigo) return;
    enviarCodigo(email);
  }

  function handleReenviar() {
    if (cooldown > 0 || enviandoCodigo) return;
    enviarCodigo(email);
  }

  function handleCambiarCorreo() {
    setPaso('email');
    setCodigo('');
    setErrorCodigo('');
  }

  async function handleSubmitCodigo(e) {
    e.preventDefault();
    if (creandoCuenta) return;
    if (!/^\d{6}$/.test(codigo)) { setErrorCodigo('El código debe tener 6 dígitos.'); return; }
    if (password.length < 8) { setErrorCodigo('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (password !== confirmar) { setErrorCodigo('Las contraseñas no coinciden.'); return; }
    setCreandoCuenta(true);
    setErrorCodigo('');

    // canjearInvitacion revalida el código, crea la cuenta y otorga el rol
    // atómicamente (server-side, Admin SDK) — o falla entero sin dejar nada a
    // medias. emailVerified queda true: el código ya probó que el correo existe.
    try {
      const { restauranteId, rol } = await canjearInvitacion({ token, codigo, password });
      navigate(`/restaurante/${restauranteId}/${rol}`, { replace: true });
    } catch (e) {
      setErrorCodigo(e?.message || 'No se pudo completar el registro. Intenta de nuevo.');
      setCreandoCuenta(false);
    }
  }

  if (cargando) return <div className="min-h-screen bg-neutral-950" />;

  if (!invitacion) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
        <div className="text-center px-6 max-w-sm">
          <p className="text-red-400 text-xs tracking-widest uppercase mb-2">Invitación inválida</p>
          <h1 className="text-2xl font-bold mb-4">No se puede continuar</h1>
          <p className="text-neutral-500 text-sm">{MOTIVO_MENSAJE[motivoInvalida] || MOTIVO_MENSAJE['no-existe']}</p>
        </div>
      </div>
    );
  }

  const rolLabel = invitacion.rol === 'admin' ? 'administrador' : 'cocina';

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
      <div className="border border-neutral-800 p-8 w-full max-w-sm">
        <p className="text-amber-400 text-xs tracking-widest uppercase mb-1">MesaDigital</p>
        <h1 className="text-2xl font-bold mb-1">Crear cuenta</h1>
        <p className="text-neutral-500 text-sm mb-6">
          Acceso de <span className="text-amber-400">{rolLabel}</span> para{' '}
          <span className="text-white">{invitacion.nombreRestaurante || 'este restaurante'}</span>
        </p>

        {paso === 'email' ? (
          <form onSubmit={handleSubmitEmail} className="space-y-4">
            <input
              type="email"
              placeholder="Correo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 text-base text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
            />
            {errorEmail && <p className="text-red-400 text-sm">{errorEmail}</p>}
            <button type="submit" disabled={enviandoCodigo}
              className="w-full bg-amber-400 text-black py-3 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
              {enviandoCodigo ? 'Enviando código...' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmitCodigo} className="space-y-4">
            <div className="text-sm text-neutral-500">
              Código enviado a <span className="text-white">{email}</span>.{' '}
              <button type="button" onClick={handleCambiarCorreo}
                className="text-amber-400 hover:text-amber-300 underline underline-offset-2">
                Cambiar correo
              </button>
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Código de 6 dígitos"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              ref={codigoInputRef}
              maxLength={6}
              required
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 text-base tracking-[0.3em] text-center text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
            />
            <div className="relative">
              <input
                type={verPassword ? 'text' : 'password'}
                placeholder="Contraseña (mínimo 8 caracteres)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 pr-12 text-base text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-amber-400 transition-colors text-sm select-none">
                {verPassword ? '🙈' : '👁'}
              </button>
            </div>
            <input
              type={verPassword ? 'text' : 'password'}
              placeholder="Confirmar contraseña"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 text-base text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
            />
            {errorCodigo && <p className="text-red-400 text-sm">{errorCodigo}</p>}
            <button type="submit" disabled={creandoCuenta}
              className="w-full bg-amber-400 text-black py-3 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
              {creandoCuenta ? 'Creando cuenta...' : 'Crear cuenta y entrar'}
            </button>
            <button type="button" onClick={handleReenviar} disabled={cooldown > 0 || enviandoCodigo}
              className="w-full text-center text-sm text-neutral-500 hover:text-amber-400 transition-colors disabled:hover:text-neutral-500 disabled:opacity-50 min-h-[44px]">
              {cooldown > 0 ? `Reenviar código (${cooldown}s)` : (enviandoCodigo ? 'Enviando...' : 'Reenviar código')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Invitacion;
