/**
 * IMPORTANT LEGAL NOTICE FOR PROJECT OWNER:
 * The Terms of Use, Privacy Policy, and Risk Disclosure templates in this file
 * are written in plain English for informational completeness. They do NOT
 * constitute formal legal counsel. A qualified financial and technology lawyer
 * in your jurisdiction MUST review and customize these documents before production launch.
 */

import React, { useEffect } from 'react';
import { ArrowLeft, ShieldAlert, FileText, Lock } from 'lucide-react';

export type LegalSlug = '/terms' | '/privacy' | '/risk-disclosure';

interface LegalPageProps {
  slug: LegalSlug;
  onNavigate: (path: string) => void;
}

export const LegalPage: React.FC<LegalPageProps> = ({ slug, onNavigate }) => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [slug]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <div
      className="min-h-screen w-full bg-[#050505] text-[#FAFAFA] selection:bg-[#E8B84A]/30 selection:text-[#FFD97A] px-4 sm:px-6 py-12"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 3.5rem)',
      }}
    >
      <div className="mx-auto w-full max-w-[720px]">
        {/* Top Bar: Back to Home + Quick Legal Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-6 mb-8 border-b border-[#E8B84A]/20">
          <a
            href="/"
            onClick={(e) => handleLinkClick(e, '/')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/5 hover:bg-[#E8B84A]/15 border border-[#E8B84A]/35 text-[#FFD97A] font-mono text-xs tracking-[0.16em] uppercase transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to SARRAF</span>
          </a>

          <nav aria-label="Legal navigation" className="flex items-center gap-2 font-mono text-[11px]">
            <a
              href="/terms"
              onClick={(e) => handleLinkClick(e, '/terms')}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                slug === '/terms'
                  ? 'bg-[#E8B84A]/20 border-[#FFD97A] text-[#FFD97A]'
                  : 'border-white/10 text-neutral-400 hover:text-white'
              }`}
            >
              Terms
            </a>
            <a
              href="/privacy"
              onClick={(e) => handleLinkClick(e, '/privacy')}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                slug === '/privacy'
                  ? 'bg-[#E8B84A]/20 border-[#FFD97A] text-[#FFD97A]'
                  : 'border-white/10 text-neutral-400 hover:text-white'
              }`}
            >
              Privacy
            </a>
            <a
              href="/risk-disclosure"
              onClick={(e) => handleLinkClick(e, '/risk-disclosure')}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                slug === '/risk-disclosure'
                  ? 'bg-[#E8B84A]/20 border-[#FFD97A] text-[#FFD97A]'
                  : 'border-white/10 text-neutral-400 hover:text-white'
              }`}
            >
              Risk Disclosure
            </a>
          </nav>
        </div>

        {/* Main Content Card */}
        <article className="sarraf-glass p-6 sm:p-10 space-y-6">
          <span className="sarraf-corner-tl" />
          <span className="sarraf-corner-tr" />
          <span className="sarraf-corner-bl" />
          <span className="sarraf-corner-br" />

          {slug === '/terms' && (
            <>
              <header className="space-y-2 border-b border-white/10 pb-5">
                <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.26em] text-[#E8B84A] uppercase">
                  <FileText className="w-3.5 h-3.5 text-[#FFD97A]" />
                  <span>SARRAF LEGAL ARCHIVE</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  Terms of{' '}
                  <span className="font-serif italic font-normal text-[#FFD97A]">
                    Use
                  </span>
                </h1>
                <p className="font-mono text-xs text-neutral-400">
                  Last updated: November 1, 2026
                </p>
              </header>

              <div className="space-y-5 text-sm sm:text-[15px] text-neutral-300 leading-relaxed">
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    1. Private, Invite-Only Access
                  </h2>
                  <p>
                    SARRAF is a private, invite-only market telemetry and XAU/USD analytical platform. Access credentials are issued solely to approved members by the administrator. You may not share, resell, sublicense, or redistribute your terminal login or Telegram relay access to any third party.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    2. Informational &amp; Educational Purpose Only
                  </h2>
                  <p>
                    All spot gold (XAU/USD) prices, macro radar alerts, target zones, invalidation levels, and Telegram dispatches provided by SARRAF are strictly for informational and research purposes. Nothing on this website, inside the terminal, or inside the Telegram bot constitutes personalized investment advice, financial promotion, or a solicitation to buy or sell any financial instrument.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    3. Data Accuracy &amp; Availability
                  </h2>
                  <p>
                    While SARRAF sources live XAU/USD quotes from institutional feeds with automated fallback and stale-tick detection, market data may occasionally be delayed or interrupted during illiquid windows or upstream maintenance. You agree not to rely solely on SARRAF telemetry for trade execution without verifying quotes directly with your licensed broker.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    4. Account Revocation &amp; Acceptable Use
                  </h2>
                  <p>
                    We reserve the right to suspend or revoke terminal access immediately if we detect automated scraping, credential sharing, brute-force authentication attempts, or unauthorized redistribution of SARRAF signals.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    5. Limitation of Liability
                  </h2>
                  <p>
                    To the maximum extent permitted by applicable law, SARRAF and its operators shall not be liable for any direct, indirect, incidental, or consequential trading losses, lost profits, or damages arising from your use of—or inability to use—this terminal.
                  </p>
                </section>
              </div>
            </>
          )}

          {slug === '/privacy' && (
            <>
              <header className="space-y-2 border-b border-white/10 pb-5">
                <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.26em] text-[#E8B84A] uppercase">
                  <Lock className="w-3.5 h-3.5 text-[#FFD97A]" />
                  <span>SARRAF PRIVACY CHARTER</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  Privacy{' '}
                  <span className="font-serif italic font-normal text-[#FFD97A]">
                    Policy
                  </span>
                </h1>
                <p className="font-mono text-xs text-neutral-400">
                  Last updated: November 1, 2026
                </p>
              </header>

              <div className="space-y-5 text-sm sm:text-[15px] text-neutral-300 leading-relaxed">
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    1. Minimal Data Collection
                  </h2>
                  <p>
                    SARRAF is engineered with strict privacy by design. We collect only the minimum information required to authenticate your invite-only terminal session (your assigned username/email and an encrypted HTTP-only session cookie).
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    2. Zero Client-Side Password Storage
                  </h2>
                  <p>
                    Your password is never logged to the browser console and is never stored in <code className="text-[#FFD97A]">localStorage</code> or <code className="text-[#FFD97A]">sessionStorage</code>. Authentication is verified over HTTPS via our backend endpoint (<code className="text-[#FFD97A]">POST /api/auth/login</code>) using hashed credentials.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    3. Invite Requests via WhatsApp
                  </h2>
                  <p>
                    When you use the “Request access” form inside the login modal, your name, WhatsApp number, and optional note are formatted directly on your device to open a WhatsApp chat with the administrator and copy the text to your clipboard. SARRAF does not store those request fields in any client-side or third-party marketing database.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    4. Local Preferences &amp; Service Worker Cache
                  </h2>
                  <p>
                    We store non-personal UI preferences (such as whether the 3D intro diamond animation has already played in your current tab session) in browser storage. Our Progressive Web App service worker caches static shell assets only and never caches <code className="text-[#FFD97A]">/api/*</code> price or authentication responses.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    5. No Third-Party Ad Tracking
                  </h2>
                  <p>
                    We do not sell, rent, or trade member information to advertisers, data brokers, or external analytics networks. You may request deletion of your terminal account at any time by contacting the administrator on WhatsApp.
                  </p>
                </section>
              </div>
            </>
          )}

          {slug === '/risk-disclosure' && (
            <>
              <header className="space-y-2 border-b border-white/10 pb-5">
                <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.26em] text-[#E8B84A] uppercase">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#FFD97A]" />
                  <span>REGULATORY &amp; MARKET RISK NOTICE</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  Risk{' '}
                  <span className="font-serif italic font-normal text-[#FFD97A]">
                    Disclosure
                  </span>
                </h1>
                <p className="font-mono text-xs text-neutral-400">
                  Last updated: November 1, 2026
                </p>
              </header>

              <div className="space-y-5 text-sm sm:text-[15px] text-neutral-300 leading-relaxed">
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    1. High Risk of Leveraged Gold (XAU/USD) Trading
                  </h2>
                  <p>
                    Trading spot gold (XAU/USD), foreign exchange, bullion futures, and Contracts for Difference (CFDs) on margin carries a high level of risk and may not be suitable for all investors. Leverage can work against you as well as for you. Before deciding to trade, you should carefully consider your investment objectives, level of experience, and risk appetite.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    2. Possibility of Capital Loss
                  </h2>
                  <p>
                    There is a possibility that you could sustain a loss of some or all of your initial capital. Therefore, you should never fund trading activity with money that you cannot afford to lose. If you have any doubts, seek advice from an independent, licensed financial advisor.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    3. No Guarantee of Performance
                  </h2>
                  <p>
                    Past performance of any SARRAF analytical model, backtest, or historical Telegram dispatch is not indicative of future results. Market volatility—particularly around US CPI, Non-Farm Payrolls (NFP), FOMC rate decisions, and geopolitical shocks—can cause rapid price gaps and slippage beyond stated stop-loss levels.
                  </p>
                </section>

                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[#FFD97A] font-mono uppercase tracking-wider">
                    4. Non-Advisory Research Platform
                  </h2>
                  <p>
                    SARRAF does not act as a broker-dealer, custodian, or registered investment advisor. Every participant retains 100% sole responsibility for their own trade execution, position sizing, and risk management.
                  </p>
                </section>
              </div>
            </>
          )}

          {/* Footer inside Legal Card */}
          <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 font-mono text-xs text-neutral-500">
            <span>© 2026 SARRAF · XAU/USD INTELLIGENCE</span>
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className="text-[#FFD97A] hover:underline"
            >
              Return to Live Terminal →
            </a>
          </div>
        </article>
      </div>
    </div>
  );
};

export default LegalPage;
