import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Mail, ArrowRight, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { supabaseAuth } from '../lib/supabaseAuthClient';
import AnimatedCard from '../components/shared/AnimatedCard';
import FadePresence, { fadeVariants } from '../components/shared/FadePresence';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { cn } from '../lib/utils';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginView() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');
  const [touched, setTouched] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const emailInvalid = touched && email.length > 0 && !EMAIL_RX.test(email);

  const handleMagicLink = async (e) => {
    e.preventDefault();
    if (!email || !EMAIL_RX.test(email)) {
      setTouched(true);
      return;
    }

    setStatus('sending');
    setErrorMsg('');

    const { error } = await supabaseAuth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setStatus('error');
      setErrorMsg(error.message || 'Error al enviar, probá de nuevo.');
    } else {
      setStatus('sent');
    }
  };

  const resetToIdle = () => {
    setStatus('idle');
    setErrorMsg('');
  };

  return (
    <main className="relative min-h-screen bg-surface-950 flex items-center justify-center p-6 overflow-hidden">
      {/* Gradient mesh background */}
      <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true">
        <motion.div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-primary-500/25 blur-3xl"
          animate={shouldReduceMotion ? undefined : { x: [0, 40, -20, 0], y: [0, 30, -10, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/3 -right-32 w-[500px] h-[500px] rounded-full bg-primary-500/20 blur-3xl"
          animate={shouldReduceMotion ? undefined : { x: [0, -30, 20, 0], y: [0, 40, -20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-40 left-1/4 w-[550px] h-[550px] rounded-full bg-primary-500/15 blur-3xl"
          animate={shouldReduceMotion ? undefined : { x: [0, 30, -15, 0], y: [0, -20, 15, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* subtle vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-surface-950/60" />
      </div>

      <AnimatedCard className="w-full max-w-md relative">
        <div className="bg-card/60 backdrop-blur-xl border border-border rounded-xl shadow-elevation-3 p-8">
          {/* Logo / wordmark */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary-500 shadow-glow flex items-center justify-center">
                <span className="text-white font-bold text-base">E</span>
              </div>
              <span className="text-3xl font-semibold text-primary-500 tracking-tight">
                Empírika
              </span>
            </div>
            <span className="text-sm text-muted-foreground tracking-wide uppercase">
              AI Fleet · Flota IA
            </span>
          </div>

          {/* Headline */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-surface-50 mb-2">
              Entrá a tu AI Fleet
            </h1>
            <p className="text-sm text-muted-foreground">
              8 agentes trabajando 24/7 para tu pipeline.
            </p>
          </div>

          {/* State-switching body */}
          <FadePresence>
            {status === 'sent' ? (
              <motion.div
                key="sent"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                role="status"
                aria-live="polite"
                className="flex flex-col items-center text-center py-4"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -10 }}
                  animate={{ scale: [0, 1.15, 1], rotate: 0 }}
                  transition={{ duration: 0.55, times: [0, 0.7, 1], ease: 'easeOut' }}
                  className="mb-4"
                  aria-hidden="true"
                >
                  <CheckCircle2 className="w-16 h-16 text-semantic-success" strokeWidth={1.75} />
                </motion.div>
                <h2 className="text-lg font-semibold text-surface-50 mb-2">
                  Revisá tu bandeja
                </h2>
                <p className="text-sm text-muted-foreground mb-1">
                  Te enviamos un link mágico a
                </p>
                <p className="text-sm font-medium text-surface-50 mb-4 break-all">
                  {email}
                </p>
                <p className="text-xs text-muted-foreground mb-6">
                  Expira en 1 hora. Si no lo ves, revisá spam.
                </p>
                <button
                  type="button"
                  onClick={resetToIdle}
                  className="text-xs text-primary-500 hover:text-primary-400 underline underline-offset-4 transition-colors"
                >
                  Usar otro email
                </button>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                onSubmit={handleMagicLink}
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                    Email corporativo
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => setTouched(true)}
                      disabled={status === 'sending'}
                      placeholder="tu@empresa.com"
                      autoComplete="email"
                      autoFocus
                      aria-invalid={emailInvalid || undefined}
                      aria-describedby={emailInvalid ? 'email-error' : undefined}
                      className={cn(
                        'pl-9 bg-surface-950/60 text-surface-50 border-surface-700 focus-visible:ring-primary-500 placeholder:text-surface-500',
                        emailInvalid && 'border-destructive focus-visible:ring-destructive'
                      )}
                    />
                  </div>
                  {emailInvalid && (
                    <p id="email-error" role="alert" className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" aria-hidden="true" />
                      Email inválido
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={status === 'sending' || !email || emailInvalid}
                  className="w-full bg-primary-500 hover:bg-primary-400 text-white shadow-glow"
                >
                  {status === 'sending' ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Enviando…
                    </>
                  ) : (
                    <>
                      Enviar link mágico
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </Button>

                {status === 'error' && (
                  <motion.div
                    variants={fadeVariants}
                    initial="initial"
                    animate="animate"
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </motion.div>
                )}

                <p className="text-[11px] text-muted-foreground text-center pt-2">
                  🔒 Sin password. Sin registro. Link mágico a tu email.
                </p>
              </motion.form>
            )}
          </FadePresence>
        </div>

        <p className="mt-6 text-[11px] text-surface-500 text-center">
          Si no tenés cuenta, pedísela a Brian.
        </p>
      </AnimatedCard>
    </main>
  );
}
