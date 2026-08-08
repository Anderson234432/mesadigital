import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { validarInvitacion, canjearInvitacion } from '../services/invitacionesService';
import { enviarVerificacionEmail } from '../services/authService';
import { obtenerNombreRestaurante } from '../services/restaurantesService';

const MOTIVO_MENSAJE = {
  'no-existe': 'Este enlace de invitación no es válido.',
  revocada: 'Esta invitación fue revocada. Pide una nueva.',
  usada: 'Esta invitación ya fue usada. Si crees que es un error, pide una nueva.',
  vencida: 'Esta invitación venció. Pide una nueva.',
};

function Invitacion() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [cargando, setCargando] = useState(true);
  const [invitacion, setInvitacion] = useState(null); // { restauranteId, rol, nombreRestaurante }
  const [motivoInvalida, setMotivoInvalida] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

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

  async function handleSubmit(e) {
    e.preventDefault();
    if (enviando) return;
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (password !== confirmar) { setError('Las contraseñas no coinciden.'); return; }
    setEnviando(true);
    setError('');

    // canjearInvitacion crea la cuenta y otorga el rol atómicamente
    // (server-side, Admin SDK) — o falla entero sin dejar nada a medias.
    try {
      const { restauranteId, rol } = await canjearInvitacion({ token, email, password });
      enviarVerificacionEmail().catch((e) => console.error('No se pudo enviar el correo de verificación:', e));
      navigate(`/restaurante/${restauranteId}/${rol}`, { replace: true });
    } catch (e) {
      // El mensaje real (ya en español, incluyendo el caso de correo
      // existente) viene de la Cloud Function — no se oculta detrás de un
      // texto genérico.
      setError(e?.message || 'No se pudo completar el registro. Intenta de nuevo.');
      setEnviando(false);
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

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
      <div className="border border-neutral-800 p-8 w-full max-w-sm">
        <p className="text-amber-400 text-xs tracking-widest uppercase mb-1">MesaDigital</p>
        <h1 className="text-2xl font-bold mb-1">Crear cuenta</h1>
        <p className="text-neutral-500 text-sm mb-6">
          Acceso de <span className="text-amber-400">{invitacion.rol === 'admin' ? 'administrador' : 'cocina'}</span> para{' '}
          <span className="text-white">{invitacion.nombreRestaurante || 'este restaurante'}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Correo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 text-base text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
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
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={enviando}
            className="w-full bg-amber-400 text-black py-3 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
            {enviando ? 'Creando cuenta...' : 'Crear cuenta y entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Invitacion;
