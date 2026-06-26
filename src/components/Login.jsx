import { useState } from 'react';
import { login, recuperarPassword } from '../services/authService';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    try {
      await login(email, password);
    } catch {
      setError('Correo o contraseña incorrectos');
    }
  }

  async function handleRecuperar() {
    if (!email) { setError('Escribe tu correo primero'); return; }
    await recuperarPassword(email);
    setError('');
    alert('Correo de recuperación enviado');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-serif flex items-center justify-center">
      <div className="border border-neutral-800 p-8 w-full max-w-sm">
        <p className="text-amber-400 text-xs tracking-widest uppercase mb-1">MesaDigital</p>
        <h1 className="text-2xl font-bold mb-6">Acceso</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            placeholder="Correo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit"
            className="w-full bg-amber-400 text-black py-2 font-bold hover:bg-amber-300 transition-colors">
            Entrar
          </button>
          <button type="button" onClick={handleRecuperar}
            className="w-full text-neutral-500 text-sm hover:text-amber-400 transition-colors mt-2">
            ¿Olvidaste tu contraseña?
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
