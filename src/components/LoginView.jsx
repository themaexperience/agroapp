import React, { useState } from 'react';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Building2,
  Sparkles,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function LoginView({ onLoginSuccess, notify }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleLogin(e) {
    if (e) e.preventDefault();
    setErrorMessage('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Ingresá tu correo electrónico corporativo.');
      return;
    }
    if (!password) {
      setErrorMessage('Ingresá tu contraseña de acceso.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        if (
          error.message.toLowerCase().includes('invalid login credentials') ||
          error.message.toLowerCase().includes('invalid grant')
        ) {
          throw new Error('El correo o la contraseña son incorrectos. Verificá tus credenciales.');
        }
        throw error;
      }

      if (data?.session) {
        notify?.('Sesión iniciada correctamente en San José.', 'success');
        onLoginSuccess?.(data.session);
      } else {
        throw new Error('No se pudo establecer la sesión de usuario. Intentá nuevamente.');
      }
    } catch (err) {
      console.error('Error de autenticación:', err);
      setErrorMessage(err.message || 'Error al iniciar sesión.');
      notify?.(`Error de autenticación: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 p-4 sm:p-6 font-sans">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Encabezado Institucional San José */}
        <div className="p-6 sm:p-8 bg-gradient-to-b from-emerald-900 to-emerald-950 text-white text-center relative overflow-hidden">
          {/* Círculo decorativo de fondo */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 rounded-2xl bg-white p-2 shadow-lg border border-emerald-400/30 mb-4 flex items-center justify-center">
              <img
                src="/logo-san-jose.png"
                alt="Establecimiento San José"
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </div>

            <span className="text-[11px] font-black uppercase tracking-widest text-emerald-300">
              Agroganadera Rincón del Sur S.A.
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-white mt-0.5 tracking-tight">
              Establecimiento San José
            </h1>
            <p className="text-xs text-emerald-100/80 mt-1 font-medium">
              Las Flores, Bs. As. · 2.068,1 ha
            </p>
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-800/60 border border-emerald-400/20 text-[11px] text-emerald-200 font-bold">
              <Sparkles className="w-3 h-3 text-amber-300" />
              Gestión Integral Ganadera & Agrícola
            </div>
          </div>
        </div>

        {/* Formulario de Login */}
        <div className="p-6 sm:p-8 space-y-5">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
              Acceso al Sistema
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ingresá tus credenciales autorizadas para operar la plataforma.
            </p>
          </div>

          {/* Banner de Error */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-start gap-2.5 animate-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-snug">{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="usuario@estanciasanjose.com.ar"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMessage('');
                  }}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 font-medium transition"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMessage('');
                  }}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700 font-medium transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-slate-400 hover:text-slate-700 absolute right-3 top-1/2 -translate-y-1/2 transition"
                  title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-emerald-900 hover:bg-emerald-800 active:scale-[0.99] text-white font-black text-xs shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-300" />
                  <span>Autenticando en San José...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 text-emerald-300" />
                  <span>Ingresar al Sistema</span>
                </>
              )}
            </button>
          </form>

          {/* Pie de seguridad */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600 font-medium">
            <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              Supabase Auth Seguro
            </span>
            <span>Uso Interno Exclusivo</span>
          </div>
        </div>
      </div>
    </div>
  );
}
