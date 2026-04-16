import React, { useState } from 'react';
import { supabaseAuth } from '../lib/supabaseAuthClient';

export default function LoginView() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleMagicLink = async (e) => {
    e.preventDefault();
    if (!email) return;
    setStatus('sending');
    setErrorMsg('');

    const { error } = await supabaseAuth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
    } else {
      setStatus('sent');
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface-900 border border-surface-800 rounded-lg p-8 shadow-soft">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded bg-primary-500 shadow-glow flex items-center justify-center">
            <span className="text-white font-bold text-sm">E</span>
          </div>
          <span className="font-semibold text-surface-50 tracking-tight">enrich.workspace</span>
        </div>

        <h1 className="text-lg font-semibold text-surface-50 mb-1">Sign in</h1>
        <p className="text-sm text-surface-400 mb-6">
          Te enviamos un enlace mágico a tu email — hacé click y entrás.
        </p>

        {status === 'sent' ? (
          <div className="rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 p-4 text-sm">
            Revisá tu bandeja de entrada en <strong>{email}</strong>. El link expira en 1 hora.
          </div>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-surface-300 uppercase tracking-wide">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={status === 'sending'}
                placeholder="tu@email.com"
                className="mt-1 w-full bg-surface-950 text-surface-50 rounded-md px-3 py-2 text-sm border border-surface-700 focus:border-primary-500 focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={status === 'sending' || !email}
              className="w-full bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium py-2 rounded transition-colors disabled:bg-surface-700 disabled:cursor-not-allowed"
            >
              {status === 'sending' ? 'Enviando…' : 'Enviar enlace mágico'}
            </button>

            {status === 'error' && (
              <div className="rounded border border-red-500/20 bg-red-500/10 text-red-300 p-3 text-xs">
                {errorMsg}
              </div>
            )}
          </form>
        )}

        <p className="mt-6 text-[11px] text-surface-500 text-center">
          Si no tenés cuenta, pedísela a Brian.
        </p>
      </div>
    </div>
  );
}
