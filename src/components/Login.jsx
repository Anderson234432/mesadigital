import { useState } from 'react';
import { login, recuperarPassword } from '../services/authService';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [recuperado, setRecuperado] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    if (cargando) return;
    setCargando(true);
    setError('');
    try {
      await login(email, password);
    } catch (e) {
      const code = e?.code || '';
      if (code === 'auth/unauthorized-domain') {
        setError('Dominio no autorizado en Firebase. Agrega mesadigital-pi.vercel.app en Authentication → Settings → Authorized domains.');
      } else if (code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Espera unos minutos o restablece tu contraseña.');
      } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError(`Error: ${code || e?.message || 'desconocido'}`);
      }
    } finally {
      setCargando(false);
    }
  }

  async function handleRecuperar() {
    if (!email) { setError('Escribe tu correo primero'); return; }
    if (cargando) return;
    setCargando(true);
    setError('');
    try {
      await recuperarPassword(email);
      setRecuperado(true);
    } catch {
      setError('No se pudo enviar el correo. Verifica la dirección.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
      <div className="border border-neutral-800 p-8 w-full max-w-sm">
        <p className="text-amber-400 text-xs tracking-widest uppercase mb-1">MesaDigital</p>
        <h1 className="text-2xl font-bold mb-6">Acceso</h1>

        {recuperado ? (
          <div className="text-center space-y-4">
            <p className="text-green-400 text-sm">Correo de recuperación enviado. Revisa tu bandeja.</p>
            <button onClick={() => setRecuperado(false)}
              className="text-neutral-500 text-sm hover:text-amber-400 transition-colors">
              Volver al login
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              placeholder="Correo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 text-base text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
            />
            <div className="relative">
              <input
                type={verPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-neutral-900 border border-neutral-700 px-3 py-3 pr-12 text-base text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-amber-400 transition-colors text-sm select-none">
                {verPassword ? '🙈' : '👁'}
              </button>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={cargando}
              className="w-full bg-amber-400 text-black py-3 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {cargando ? 'Entrando...' : 'Entrar'}
            </button>
            <button type="button" onClick={handleRecuperar} disabled={cargando}
              className="w-full text-neutral-500 text-sm hover:text-amber-400 transition-colors py-2 disabled:opacity-50">
              ¿Olvidaste tu contraseña?
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
