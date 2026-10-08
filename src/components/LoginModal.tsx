import React, { useState } from 'react';
import { useMarket } from '../context/MarketContext';
import { X, Lock, Mail, ShieldCheck, ArrowRight } from 'lucide-react';

export const LoginModal: React.FC = () => {
  const { isLoginModalOpen, closeLoginModal, login } = useMarket();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoginModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Invalid credentials. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
      {/* Modal card */}
      <div className="relative w-full max-w-md glass-panel-glow rounded-2xl p-6 sm:p-8 border border-[#E8B84A]/40 shadow-[0_0_50px_rgba(232,184,74,0.15)] overflow-hidden">
        {/* Subtle top gold accent glow */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#FFD97A] to-transparent shadow-[0_0_15px_#FFD97A]" />

        {/* Close button */}
        <button
          onClick={closeLoginModal}
          className="absolute top-5 right-5 text-neutral-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6 space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono tracking-widest text-[#FFD97A]">
            <ShieldCheck className="w-4 h-4 text-[#E8B84A]" />
            <span>SECURE VAULT GATEWAY</span>
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight">
            SARRAF Terminal Login
          </h3>
          <p className="text-xs text-neutral-400">
            Enter your terminal credentials to authenticate with the server.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/60 border border-rose-800/60 text-xs font-mono text-rose-300">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-mono tracking-wider text-neutral-300 uppercase">
              Username / Terminal Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#E8B84A]/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="gmcf7"
                className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-mono tracking-wider text-neutral-300 uppercase">
              Master Passkey
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#E8B84A]/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter passkey"
                className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-[#FFD97A] transition-colors"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-bold text-xs font-mono tracking-[0.2em] uppercase hover:brightness-110 active:scale-98 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_25px_rgba(232,184,74,0.3)] disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>VERIFYING VAULT CLEARANCE...</span>
                </>
              ) : (
                <>
                  <span>AUTHENTICATE & ENTER</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-5 text-center text-[10px] font-mono text-neutral-500">
          TLS 1.3 256-BIT ENCRYPTION · PROPRIETARY DESK ACCESS
        </div>
      </div>
    </div>
  );
};
