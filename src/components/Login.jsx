import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError('Correo o contraseña incorrectos');
    }
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
        </form>
      </div>
    </div>
  );
}

export default Login;