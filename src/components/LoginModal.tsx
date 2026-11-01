import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMarket } from '../context/MarketContext';
import {
  X,
  Lock,
  User,
  ArrowRight,
  MessageCircle,
  AlertCircle,
  Phone,
  FileText,
  Check,
  ArrowLeft,
} from 'lucide-react';

// Exact admin WhatsApp link provided by user
const ADMIN_WA_BASE_URL = 'https://wa.me/A.h21s?s=p';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

export const LoginModal: React.FC = () => {
  const { isLoginModalOpen, closeLoginModal, login } = useMarket();

  // Mode toggle: 'login' | 'request'
  const [mode, setMode] = useState<'login' | 'request'>('login');

  // Login form state (passwords are never logged or persisted in storage)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [highlightWa, setHighlightWa] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Client-side rate limit tracking after 5 failed attempts
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  // Request Access form state (never persisted client-side)
  const [reqName, setReqName] = useState('');
  const [reqWhatsapp, setReqWhatsapp] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqError, setReqError] = useState('');
  const [copiedToast, setCopiedToast] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const reqFirstInputRef = useRef<HTMLInputElement>(null);

  // Clear sensitive fields when modal closes
  useEffect(() => {
    if (!isLoginModalOpen) {
      setPassword('');
      setErrorMsg('');
      setReqError('');
      setHighlightWa(false);
      setIsLoading(false);
      setMode('login');
    }
  }, [isLoginModalOpen]);

  // Body scroll lock while modal is open
  useEffect(() => {
    if (!isLoginModalOpen || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isLoginModalOpen]);

  // Auto-focus first input on open or mode switch
  useEffect(() => {
    if (!isLoginModalOpen) return;
    const timer = window.setTimeout(() => {
      if (mode === 'login') {
        firstInputRef.current?.focus();
      } else {
        reqFirstInputRef.current?.focus();
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [isLoginModalOpen, mode]);

  // Escape key & Tab focus trap inside dialog
  useEffect(() => {
    if (!isLoginModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLoginModal();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoginModalOpen, closeLoginModal]);

  // Countdown timer when rate-limited after 5 failed attempts
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const id = window.setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          setFailedAttempts(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockoutRemaining]);

  const openWhatsAppWithText = useCallback((messageText?: string) => {
    const url = messageText
      ? `${ADMIN_WA_BASE_URL}&text=${encodeURIComponent(messageText)}`
      : ADMIN_WA_BASE_URL;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (lockoutRemaining > 0) {
      setErrorMsg(
        `Too many failed attempts. Please wait ${lockoutRemaining}s or contact the admin on WhatsApp.`
      );
      setHighlightWa(true);
      setShakeKey((k) => k + 1);
      return;
    }

    const cleanUser = username.trim();
    if (!cleanUser || !password) return;

    setIsLoading(true);
    setErrorMsg('');

    try {
      // Connects to MarketContext.login() -> POST /api/auth/login
      const result: unknown = await login(cleanUser, password);
      const isSuccess =
        typeof result === 'boolean'
          ? result
          : Boolean((result as { success?: boolean })?.success);

      if (!isSuccess) {
        const nextCount = failedAttempts + 1;
        setFailedAttempts(nextCount);
        setHighlightWa(true);
        setShakeKey((k) => k + 1);

        if (nextCount >= MAX_FAILED_ATTEMPTS) {
          setLockoutRemaining(LOCKOUT_SECONDS);
          setErrorMsg(
            `Rate limit reached (${MAX_FAILED_ATTEMPTS} failed attempts). Locked for ${LOCKOUT_SECONDS}s — contact the admin on WhatsApp.`
          );
        } else {
          setErrorMsg(
            'Access denied. Invite-only — contact the admin on WhatsApp to get a login or reset your password.'
          );
        }
      } else {
        setFailedAttempts(0);
        setPassword('');
      }
    } catch {
      setHighlightWa(true);
      setShakeKey((k) => k + 1);
      setErrorMsg(
        'Access denied. Invite-only — contact the admin on WhatsApp to get a login or reset your password.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestAccessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError('');

    const trimmedName = reqName.trim();
    const trimmedPhone = reqWhatsapp.trim();
    const trimmedNote = reqNote.trim();

    if (trimmedName.length < 2) {
      setReqError('Please enter your full name.');
      setShakeKey((k) => k + 1);
      return;
    }

    // Validate phone / WhatsApp format (digits, +, spaces, dashes; at least 7 digits)
    const digitsOnly = trimmedPhone.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 16) {
      setReqError('Please enter a valid WhatsApp phone number (with country code).');
      setShakeKey((k) => k + 1);
      return;
    }

    const formattedMsg = [
      'SARRAF Terminal — Invite Access Request',
      `Name: ${trimmedName}`,
      `WhatsApp: ${trimmedPhone}`,
      trimmedNote ? `Note: ${trimmedNote}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Copy to clipboard + show "Message copied" toast in case wa.me shortlink strips &text
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(formattedMsg);
        setCopiedToast(true);
        window.setTimeout(() => setCopiedToast(false), 3800);
      }
    } catch {
      // Clipboard API unavailable in restricted context; proceed to open WhatsApp
    }

    // Store no data client-side: clear fields immediately
    setReqName('');
    setReqWhatsapp('');
    setReqNote('');

    openWhatsAppWithText(formattedMsg);
  };

  if (!isLoginModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/82 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeLoginModal();
      }}
    >
      <div
        ref={dialogRef}
        key={shakeKey}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sarraf-login-modal-title"
        style={{
          width: 'min(360px, calc(100% - 32px))',
          padding: '20px 18px 16px',
          borderRadius: '22px',
          maxHeight: '92svh',
        }}
        className={`relative overflow-y-auto bg-[#0b0b0d]/95 border border-[#E8B84A]/35 shadow-[0_24px_60px_rgba(0,0,0,0.9),0_0_32px_rgba(232,184,74,0.12)] text-[#FAFAFA] ${
          shakeKey > 0 ? 'sarraf-shake' : ''
        }`}
      >
        {/* Subtle top gold hairline */}
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD97A]/60 to-transparent" />

        {/* Close button (32px x 32px) */}
        <button
          type="button"
          onClick={closeLoginModal}
          aria-label="Close login modal"
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Compact Header */}
        <div className="pr-8">
          <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-[0.22em] text-[#E8B84A] uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FFD97A]" />
            <span>SECURE VAULT GATEWAY</span>
          </div>

          <h2
            id="sarraf-login-modal-title"
            style={{ fontSize: 'clamp(22px, 6.2vw, 26px)' }}
            className="mt-1 font-semibold tracking-tight text-white leading-tight whitespace-nowrap"
          >
            SARRAF{' '}
            <span className="font-serif italic font-normal text-[#FFD97A]">
              Terminal
            </span>{' '}
            Login
          </h2>

          <p className="mt-0.5 text-[12.5px] text-neutral-400 leading-snug">
            Private, invite-only access.
          </p>
        </div>

        {/* Toast when Request Access message is copied to clipboard */}
        {copiedToast && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px]"
          >
            <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <span>Message copied — paste in WhatsApp if needed.</span>
          </div>
        )}

        {mode === 'login' ? (
          <>
            {/* Inline Error Banner (compact so modal never overflows screen) */}
            {errorMsg && (
              <div
                role="alert"
                aria-live="assertive"
                className="mt-2.5 p-2 rounded-xl bg-rose-950/55 border border-rose-500/40 flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-rose-200/95 leading-tight">
                  {errorMsg}
                </p>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleLoginSubmit} className="mt-3 space-y-2.5" noValidate>
              <div>
                <label
                  htmlFor="sarraf-login-username"
                  className="block text-[9px] font-mono uppercase tracking-[0.18em] text-neutral-400 mb-1"
                >
                  Username / Terminal ID
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={firstInputRef}
                    id="sarraf-login-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="Enter username"
                    required
                    className="w-full h-[46px] pl-9 pr-3 bg-black/75 border border-white/12 rounded-xl text-[16px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors font-mono"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="sarraf-login-password"
                  className="block text-[9px] font-mono uppercase tracking-[0.18em] text-neutral-400 mb-1"
                >
                  Passkey / Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="sarraf-login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="••••••••"
                    required
                    className="w-full h-[46px] pl-9 pr-3 bg-black/75 border border-white/12 rounded-xl text-[16px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || lockoutRemaining > 0}
                className="w-full h-[48px] mt-1 bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] hover:brightness-110 active:scale-[0.99] text-black font-mono font-bold text-[11px] tracking-[0.16em] uppercase rounded-xl transition-all shadow-[0_0_20px_rgba(232,184,74,0.28)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {lockoutRemaining > 0 ? (
                  <span>LOCKED ({lockoutRemaining}S)</span>
                ) : isLoading ? (
                  <span>AUTHENTICATING...</span>
                ) : (
                  <>
                    <span>UNLOCK TERMINAL</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>

            {/* Compact "No login yet?" + Slim WhatsApp Button + Request Access toggle */}
            <div className="mt-3 pt-2.5 border-t border-white/10">
              <div className="flex items-center justify-between text-[12px] mb-2">
                <span className="text-neutral-300 font-medium">No login yet?</span>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('request');
                  }}
                  className="text-[11px] font-mono text-[#FFD97A] hover:underline cursor-pointer"
                >
                  Request access →
                </button>
              </div>

              <a
                href={ADMIN_WA_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full h-[40px] rounded-xl font-mono font-bold text-[10px] tracking-[0.14em] uppercase transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  highlightWa
                    ? 'bg-emerald-500 text-black shadow-[0_0_22px_rgba(16,185,129,0.5)] ring-2 ring-emerald-300'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>CONTACT ADMIN ON WHATSAPP</span>
              </a>
            </div>
          </>
        ) : (
          /* Request Access Form (Invite-Only) */
          <>
            {reqError && (
              <div
                role="alert"
                aria-live="assertive"
                className="mt-2.5 p-2 rounded-xl bg-rose-950/55 border border-rose-500/40 flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-rose-200/95 leading-tight">
                  {reqError}
                </p>
              </div>
            )}

            <form
              onSubmit={handleRequestAccessSubmit}
              className="mt-3 space-y-2"
              noValidate
            >
              <div>
                <label
                  htmlFor="sarraf-req-name"
                  className="block text-[9px] font-mono uppercase tracking-[0.18em] text-neutral-400 mb-1"
                >
                  Your Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={reqFirstInputRef}
                    id="sarraf-req-name"
                    type="text"
                    value={reqName}
                    onChange={(e) => {
                      setReqName(e.target.value);
                      if (reqError) setReqError('');
                    }}
                    placeholder="Full name"
                    required
                    className="w-full h-[46px] pl-9 pr-3 bg-black/75 border border-white/12 rounded-xl text-[16px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors font-mono"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="sarraf-req-wa"
                  className="block text-[9px] font-mono uppercase tracking-[0.18em] text-neutral-400 mb-1"
                >
                  WhatsApp Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="sarraf-req-wa"
                    type="tel"
                    inputMode="tel"
                    value={reqWhatsapp}
                    onChange={(e) => {
                      setReqWhatsapp(e.target.value);
                      if (reqError) setReqError('');
                    }}
                    placeholder="+1 555 234 5678"
                    required
                    className="w-full h-[46px] pl-9 pr-3 bg-black/75 border border-white/12 rounded-xl text-[16px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors font-mono"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="sarraf-req-note"
                  className="block text-[9px] font-mono uppercase tracking-[0.18em] text-neutral-400 mb-1"
                >
                  Optional Note
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="sarraf-req-note"
                    type="text"
                    value={reqNote}
                    onChange={(e) => setReqNote(e.target.value)}
                    placeholder="Desk / referral note (optional)"
                    className="w-full h-[46px] pl-9 pr-3 bg-black/75 border border-white/12 rounded-xl text-[16px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-[48px] mt-1 bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] hover:brightness-110 active:scale-[0.99] text-black font-mono font-bold text-[11px] tracking-[0.16em] uppercase rounded-xl transition-all shadow-[0_0_20px_rgba(232,184,74,0.28)] flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>SEND REQUEST ON WHATSAPP</span>
              </button>
            </form>

            <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setReqError('');
                  setMode('login');
                }}
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#FFD97A] hover:underline cursor-pointer"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Back to login</span>
              </button>
              <span className="text-[10px] font-mono text-neutral-500">
                Copies message + opens WA
              </span>
            </div>
          </>
        )}

        {/* Footer line (8px) */}
        <div className="mt-2.5 text-center font-mono text-[8px] tracking-[0.16em] text-neutral-500 uppercase">
          ENCRYPTED SESSION · ZERO CLIENT PASSWORD STORAGE
        </div>
      </div>
    </div>
  );
};
