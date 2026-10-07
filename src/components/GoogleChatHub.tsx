import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  initAuth,
  googleSignIn,
  logoutGoogle,
} from '../lib/googleAuth';
import {
  GoogleChatSpace,
  GoogleChatMessage,
  fetchGoogleChatSpaces,
  createGoogleChatSpace,
  fetchSpaceMessages,
  sendSpaceMessage,
  buildSetupReviewCard,
} from '../lib/googleChatClient';
import {
  MessageSquare,
  Sparkles,
  CheckCircle2,
  XCircle,
  Plus,
  Send,
  RefreshCw,
  Shield,
  Bot,
  BrainCircuit,
  Settings,
  AlertCircle,
  ExternalLink,
  PowerOff,
  Flame,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  Award,
  Clock,
  Trash2,
  Edit2,
  Lock,
  History,
  Check,
} from 'lucide-react';
import type { User } from 'firebase/auth';

interface GoogleChatHubProps {
  currentPrice: number | null;
  activeSignal: any;
}

export const GoogleChatHub: React.FC<GoogleChatHubProps> = ({ currentPrice, activeSignal }) => {
  // Main view tab
  const [activeTab, setActiveTab] = useState<'WAR_ROOM' | 'REVIEWS' | 'LESSONS' | 'TESTS'>('REVIEWS');

  // Auth state
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [whitelistedEmails, setWhitelistedEmails] = useState<string[]>([]);

  // Spaces & Messages
  const [spaces, setSpaces] = useState<GoogleChatSpace[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<string>('');
  const [isLoadingSpaces, setIsLoadingSpaces] = useState(false);
  const [messages, setMessages] = useState<GoogleChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [newMessageText, setNewMessageText] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Space Creation Modal
  const [isCreateSpaceModalOpen, setIsCreateSpaceModalOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('SARRAF Gold War Room & AI Learning');
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);

  // Server Reviews & Settings
  const [setupReviews, setSetupReviews] = useState<any[]>([]);
  const [chatSettings, setChatSettings] = useState<any>({
    preReviewRequired: false,
    reviewTimeoutMinutes: 3,
    autoSendOnReviewTimeout: false,
    autoPostUpdates: false,
    activeSpaceName: '',
    activeSpaceDisplayName: 'SARRAF Gold Desk & War Room',
  });

  // Curated Lessons (max 20, max 200 chars)
  const [learningItems, setLearningItems] = useState<any[]>([]);
  const [changeLog, setChangeLog] = useState<any[]>([]);
  const [isAddLessonOpen, setIsAddLessonOpen] = useState(false);
  const [isChangeLogOpen, setIsChangeLogOpen] = useState(false);
  const [lessonInsightText, setLessonInsightText] = useState('');
  const [lessonCategory, setLessonCategory] = useState<string>('STRUCTURE_BIAS');
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);

  // Hardening Tests Suite State
  const [testReport, setTestReport] = useState<any | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);

  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
        setAuthError(null);
        // Persist token encrypted on server
        if (token && user.email) {
          fetch('/api/google-chat/auth/store-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, userEmail: user.email }),
          }).catch(() => {});
        }
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Fetch server review items, settings, learnings, auth status
  const fetchBackendData = useCallback(async () => {
    try {
      const [revRes, lrnRes, setRes, authRes] = await Promise.all([
        fetch('/api/google-chat/reviews'),
        fetch('/api/google-chat/learnings'),
        fetch('/api/google-chat/settings'),
        fetch('/api/google-chat/auth/status'),
      ]);

      if (revRes.ok) {
        const revData = await revRes.json();
        setSetupReviews(revData.reviews || []);
      }
      if (lrnRes.ok) {
        const lrnData = await lrnRes.json();
        setLearningItems(lrnData.learnings || []);
      }
      if (setRes.ok) {
        const setData = await setRes.json();
        setChatSettings(setData.settings || {});
        if (setData.whitelistedEmails) {
          setWhitelistedEmails(setData.whitelistedEmails);
        }
        if (setData.settings?.activeSpaceName && !selectedSpace) {
          setSelectedSpace(setData.settings.activeSpaceName);
        }
      }
      if (authRes.ok) {
        const aData = await authRes.json();
        if (aData.whitelistedEmails) {
          setWhitelistedEmails(aData.whitelistedEmails);
        }
      }
    } catch {
      // Background poll
    }
  }, [selectedSpace]);

  useEffect(() => {
    fetchBackendData();
    const timer = setInterval(fetchBackendData, 3000);
    return () => clearInterval(timer);
  }, [fetchBackendData]);

  // Fetch spaces when token available
  const loadSpaces = useCallback(async () => {
    if (!googleToken) return;
    setIsLoadingSpaces(true);
    try {
      const sps = await fetchGoogleChatSpaces(googleToken);
      setSpaces(sps);
      if (sps.length > 0 && !selectedSpace) {
        setSelectedSpace(sps[0].name);
      }
    } catch (err: any) {
      console.error('Error fetching Google Chat spaces:', err);
      setAuthError(err.message || 'Failed to load Google Chat spaces');
    } finally {
      setIsLoadingSpaces(false);
    }
  }, [googleToken, selectedSpace]);

  useEffect(() => {
    if (googleToken) {
      loadSpaces();
    }
  }, [googleToken, loadSpaces]);

  // Fetch messages from active space
  const loadMessages = useCallback(async () => {
    if (!googleToken || !selectedSpace) return;
    setIsLoadingMessages(true);
    try {
      const msgs = await fetchSpaceMessages(googleToken, selectedSpace);
      setMessages(msgs.reverse());
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      console.warn('Error fetching messages from space:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [googleToken, selectedSpace]);

  useEffect(() => {
    if (googleToken && selectedSpace) {
      loadMessages();
      const interval = setInterval(loadMessages, 5000);
      return () => clearInterval(interval);
    }
  }, [googleToken, selectedSpace, loadMessages]);

  // Sign In Handler with Whitelist Check
  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setGoogleToken(result.accessToken);

        // Store encrypted token on server
        const resp = await fetch('/api/google-chat/auth/store-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: result.accessToken, userEmail: result.user.email }),
        });

        if (!resp.ok) {
          const errData = await resp.json();
          setAuthError(errData.error || 'Account not permitted.');
        } else {
          setActionNotice(`Connected Google Account: ${result.user.displayName || result.user.email}`);
        }
      }
    } catch (err: any) {
      setAuthError(err.message || 'Google Sign-in failed. Please retry.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Disconnect & Revoke Token
  const handleDisconnectGoogle = async () => {
    try {
      await fetch('/api/google-chat/auth/disconnect', { method: 'POST' });
    } catch {}
    await logoutGoogle();
    setGoogleUser(null);
    setGoogleToken(null);
    setSpaces([]);
    setMessages([]);
    setActionNotice('Google Chat disconnected and OAuth token revoked.');
    fetchBackendData();
  };

  // Turn Feature Fully OFF (1-Click)
  const handleTurnFeatureFullyOff = async () => {
    const confirmed = window.confirm(
      'Turn Google Chat Pre-Review completely OFF?\n\nThis will restore the standard automatic flow (Phase 4), revoke all tokens, and release any pending reviews immediately.'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/google-chat/turn-off', { method: 'POST' });
      if (res.ok) {
        await logoutGoogle();
        setGoogleUser(null);
        setGoogleToken(null);
        setActionNotice('Google Chat Pre-Review turned completely OFF. Automatic Gemini flow active.');
        fetchBackendData();
      }
    } catch (err: any) {
      setAuthError(`Failed to turn feature off: ${err.message}`);
    }
  };

  // Save Settings Toggle / Update
  const handleUpdateSetting = async (updates: any) => {
    const updated = { ...chatSettings, ...updates };
    setChatSettings(updated);
    try {
      await fetch('/api/google-chat/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setActionNotice('Settings saved.');
    } catch {
      // error
    }
  };

  // Review Approval or Rejection
  const handleReviewAction = async (signalId: string, action: 'APPROVE' | 'REJECT') => {
    const confirmed = window.confirm(
      `${action === 'APPROVE' ? 'APPROVE and activate' : 'REJECT and cancel'} setup ${signalId}?\n\nNote: Setup levels (Entry, SL, TP1-4) are immutable and cannot be changed.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/google-chat/reviews/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId,
          action,
          reviewerEmail: googleUser?.email || 'admin@sarraf.gold',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || `Review action ${action} failed.`);
      } else {
        setActionNotice(data.message || `Setup ${signalId} ${action}ED successfully.`);
        fetchBackendData();
      }
    } catch (err: any) {
      setAuthError(`Network error during review action: ${err.message}`);
    }
  };

  // Curated Lesson Action (Add or Update)
  const handleSaveCuratedLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lessonInsightText.trim()) return;

    try {
      if (editingLessonId) {
        // Update
        const res = await fetch('/api/google-chat/learnings/curate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'UPDATE',
            id: editingLessonId,
            insight: lessonInsightText.trim(),
            category: lessonCategory,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setAuthError(data.error || 'Failed to update lesson.');
        } else {
          setActionNotice('Lesson updated in institutional memory bank.');
          setIsAddLessonOpen(false);
          setEditingLessonId(null);
          setLessonInsightText('');
          fetchBackendData();
        }
      } else {
        // Add
        const res = await fetch('/api/google-chat/learnings/curate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ADD',
            insight: lessonInsightText.trim(),
            category: lessonCategory,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setAuthError(data.error || 'Failed to add lesson.');
        } else {
          setActionNotice('Lesson sanitized and added to institutional memory bank.');
          setIsAddLessonOpen(false);
          setLessonInsightText('');
          fetchBackendData();
        }
      }
    } catch (err: any) {
      setAuthError(`Error saving lesson: ${err.message}`);
    }
  };

  const handleToggleLessonActive = async (lesson: any) => {
    try {
      const res = await fetch('/api/google-chat/learnings/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE',
          id: lesson.id,
          active: !lesson.active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Failed to toggle lesson.');
      } else {
        fetchBackendData();
      }
    } catch {}
  };

  const handleDeleteLesson = async (id: string) => {
    if (!window.confirm('Delete this curated lesson permanently?')) return;
    try {
      const res = await fetch('/api/google-chat/learnings/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DELETE', id }),
      });
      if (res.ok) {
        setActionNotice('Lesson deleted from institutional memory.');
        fetchBackendData();
      }
    } catch {}
  };

  const handleFetchChangeLog = async () => {
    try {
      const res = await fetch('/api/google-chat/learnings/changelog');
      if (res.ok) {
        const data = await res.json();
        setChangeLog(data.changelog || []);
        setIsChangeLogOpen(true);
      }
    } catch {}
  };

  // Run Hardening Tests Suite
  const handleRunHardeningTests = async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/google-chat/tests');
      if (res.ok) {
        const data = await res.json();
        setTestReport(data.report);
      }
    } catch (err: any) {
      setAuthError(`Error running tests: ${err.message}`);
    } finally {
      setIsRunningTests(false);
    }
  };

  // Send Message in War Room
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!googleToken || !selectedSpace || !newMessageText.trim()) return;

    setIsSendingMessage(true);
    try {
      await sendSpaceMessage(googleToken, selectedSpace, newMessageText.trim());
      setNewMessageText('');
      await loadMessages();
    } catch (err: any) {
      setAuthError(`Failed to send message: ${err.message}`);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const isUserWhitelisted = googleUser?.email
    ? whitelistedEmails.includes(googleUser.email.toLowerCase())
    : false;

  const activeLessonsCount = learningItems.filter((l) => l.active).length;

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      {actionNotice && (
        <div className="bg-[#E8B84A]/10 border border-[#E8B84A]/30 rounded-xl p-3 flex items-center justify-between font-mono text-xs text-[#FFD97A]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#E8B84A]" />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {authError && (
        <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-3 flex items-center justify-between font-mono text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{authError}</span>
          </div>
          <button onClick={() => setAuthError(null)} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Control Header & Hardened Status */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-[#E8B84A]/25 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-[#E8B84A]/10 border border-[#E8B84A]/30 text-[#FFD97A]">
                <MessageSquare className="w-5 h-5" />
              </span>
              <div>
                <h2 className="font-mono text-base font-bold text-white tracking-wide flex items-center gap-2">
                  GOOGLE CHAT COLLABORATION & HARDENED PRE-REVIEW
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                      chatSettings.preReviewRequired
                        ? 'bg-amber-950/60 border-amber-600/50 text-amber-300'
                        : 'bg-neutral-800/60 border-neutral-700/50 text-neutral-400'
                    }`}
                  >
                    PRE-REVIEW: {chatSettings.preReviewRequired ? 'ON' : 'OFF (DEFAULT)'}
                  </span>
                </h2>
                <p className="text-xs text-neutral-400">
                  Human-in-the-loop validation, strict one-signal locks, server-side encrypted tokens, and sanitized AI memory.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions & Master Toggle */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Master Toggle */}
            <button
              onClick={() => handleUpdateSetting({ preReviewRequired: !chatSettings.preReviewRequired })}
              className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                chatSettings.preReviewRequired
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                  : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Pre-Review: {chatSettings.preReviewRequired ? 'ACTIVE (ON)' : 'OFF'}
            </button>

            {/* Turn Feature Fully OFF Button */}
            <button
              onClick={handleTurnFeatureFullyOff}
              className="px-3 py-1.5 rounded-xl font-mono text-xs font-bold bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Turn Google Chat integration and pre-review fully OFF with 1-click"
            >
              <PowerOff className="w-3.5 h-3.5 text-rose-400" />
              Turn Fully OFF
            </button>

            {/* Google Sign In / Disconnect */}
            {googleUser ? (
              <div className="flex items-center gap-2 bg-black/50 p-1.5 rounded-xl border border-white/10">
                <div className="text-left font-mono text-xs pl-2 pr-1">
                  <div className="font-bold text-white flex items-center gap-1">
                    <span>{googleUser.displayName || 'Google Operator'}</span>
                    {isUserWhitelisted ? (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-0.5" title="Whitelisted in GOOGLE_ALLOWED_EMAILS">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Authorized
                      </span>
                    ) : (
                      <span className="text-[10px] text-rose-400 flex items-center gap-0.5" title="Not in GOOGLE_ALLOWED_EMAILS whitelist">
                        <AlertCircle className="w-3 h-3 text-rose-400" /> Not Whitelisted
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleDisconnectGoogle}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-mono text-[11px] cursor-pointer"
                >
                  Disconnect / Revoke
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleSignIn}
                disabled={isLoggingIn}
                className="px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold bg-white text-neutral-900 hover:bg-neutral-200 transition-all flex items-center gap-2 shadow cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                {isLoggingIn ? 'Connecting...' : 'Connect Google Workspace'}
              </button>
            )}
          </div>
        </div>

        {/* Security & Whitelist Assurance Bar */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between text-[11px] font-mono text-neutral-400 gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Lock className="w-3.5 h-3.5" />
              Tokens Encrypted (AES-256-GCM) at rest
            </span>
            <span className="flex items-center gap-1.5 text-blue-400">
              <Shield className="w-3.5 h-3.5" />
              Whitelist: {whitelistedEmails.join(', ') || 'admin@sarraf.gold'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>Timeout: {chatSettings.reviewTimeoutMinutes || 3}m</span>
            <span>Auto-Send on Timeout: {chatSettings.autoSendOnReviewTimeout ? 'ON' : 'OFF'}</span>
          </div>
        </div>
      </div>

      {/* Sub-Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab('REVIEWS')}
          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'REVIEWS'
              ? 'bg-[#E8B84A] text-neutral-950 shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-850'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          Pre-Review Gate ({setupReviews.filter((r) => r.status === 'PENDING_REVIEW').length})
        </button>

        <button
          onClick={() => setActiveTab('LESSONS')}
          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'LESSONS'
              ? 'bg-[#E8B84A] text-neutral-950 shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-850'
          }`}
        >
          <BrainCircuit className="w-3.5 h-3.5" />
          Curated Lessons ({activeLessonsCount}/20 Active)
        </button>

        <button
          onClick={() => setActiveTab('TESTS')}
          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'TESTS'
              ? 'bg-[#E8B84A] text-neutral-950 shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-850'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          Safety Tests (8-Step Suite)
        </button>

        <button
          onClick={() => setActiveTab('WAR_ROOM')}
          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'WAR_ROOM'
              ? 'bg-[#E8B84A] text-neutral-950 shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-850'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Google Chat Space
        </button>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* TAB 1: PRE-REVIEW GATE & PENDING SIGNALS                       */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'REVIEWS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-mono text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#E8B84A]" />
              Setup Pre-Flight Reviews (Immutable Level Protection)
            </h3>
            {/* Timeout Settings */}
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-neutral-400">Review Timeout:</span>
              <select
                value={chatSettings.reviewTimeoutMinutes || 3}
                onChange={(e) => handleUpdateSetting({ reviewTimeoutMinutes: Number(e.target.value) })}
                className="bg-neutral-900 border border-neutral-700 text-white rounded-lg px-2 py-1 text-xs"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 ml-3 cursor-pointer text-neutral-300">
                <input
                  type="checkbox"
                  checked={!!chatSettings.autoSendOnReviewTimeout}
                  onChange={(e) => handleUpdateSetting({ autoSendOnReviewTimeout: e.target.checked })}
                  className="rounded border-neutral-700 text-[#E8B84A]"
                />
                Auto-Send on Timeout (Default: OFF)
              </label>
            </div>
          </div>

          {setupReviews.length === 0 ? (
            <div className="glass-panel p-8 rounded-2xl border border-white/5 text-center text-neutral-500 font-mono text-xs">
              No signal setups currently in review queue. The system is scanning autonomously.
            </div>
          ) : (
            <div className="space-y-3">
              {setupReviews.map((rev) => {
                const isPending = rev.status === 'PENDING_REVIEW';
                const isApproved = rev.status === 'APPROVED';
                const isRejected = rev.status === 'REJECTED';
                const isTimeout = rev.status === 'REVIEW_TIMEOUT';
                const isStale = rev.status === 'STALE_AFTER_REVIEW';

                const expiresMs = rev.reviewExpiresAt ? new Date(rev.reviewExpiresAt).getTime() - Date.now() : 0;
                const expiresSec = Math.max(0, Math.round(expiresMs / 1000));

                return (
                  <div
                    key={rev.id || rev.signalId}
                    className={`glass-panel p-5 rounded-2xl border transition-all ${
                      isPending
                        ? 'border-amber-500/50 bg-amber-950/10 shadow-[0_0_15px_rgba(232,184,74,0.1)]'
                        : isApproved
                        ? 'border-emerald-500/30 bg-emerald-950/10'
                        : isRejected
                        ? 'border-rose-500/30 bg-rose-950/10'
                        : 'border-neutral-800 bg-neutral-900/30'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-mono text-xs font-bold ${
                            rev.direction === 'BUY'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {rev.direction}
                        </span>
                        <span className="font-mono text-sm font-bold text-white">{rev.signalId}</span>
                        <span className="text-xs font-mono text-neutral-400">Score: {rev.score}/100</span>
                      </div>

                      <div className="flex items-center gap-3">
                        {isPending && (
                          <div className="flex items-center gap-1.5 font-mono text-xs text-amber-300 bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-800/40 animate-pulse">
                            <Clock className="w-3.5 h-3.5" />
                            Timeout in {Math.floor(expiresSec / 60)}m {expiresSec % 60}s
                          </div>
                        )}
                        <span
                          className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                            isPending
                              ? 'bg-amber-950/60 border-amber-600/50 text-amber-300'
                              : isApproved
                              ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                              : isRejected
                              ? 'bg-rose-950/60 border-rose-600/50 text-rose-300'
                              : isTimeout
                              ? 'bg-neutral-800 border-neutral-700 text-neutral-400'
                              : 'bg-orange-950/60 border-orange-700 text-orange-300'
                          }`}
                        >
                          {rev.status}
                        </span>
                      </div>
                    </div>

                    {/* Immutable Setup Levels */}
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs font-mono mb-3 bg-black/40 p-3 rounded-xl border border-white/5">
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase">Entry Target</div>
                        <div className="font-bold text-white">${rev.entry?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-rose-400 uppercase">Stop Loss</div>
                        <div className="font-bold text-rose-300">${rev.sl?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-emerald-400 uppercase">TP1 (+BE)</div>
                        <div className="font-bold text-emerald-300">${rev.tp1?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-emerald-400 uppercase">TP2</div>
                        <div className="font-bold text-emerald-300">${rev.tp2?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-emerald-400 uppercase">TP3</div>
                        <div className="font-bold text-emerald-300">${rev.tp3?.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-emerald-400 uppercase">TP4</div>
                        <div className="font-bold text-emerald-300">${rev.tp4?.toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Bias & AI Notes */}
                    <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-neutral-400 gap-2">
                      <div className="flex items-center gap-3">
                        <span>D1: {rev.bias?.d1 || 'N/A'}</span>
                        <span>H4: {rev.bias?.h4 || 'N/A'}</span>
                        <span>H1: {rev.bias?.h1 || 'N/A'}</span>
                        {currentPrice && (
                          <span className="text-white">
                            Live Price: ${currentPrice.toFixed(2)} (Diff: ${(Math.abs(currentPrice - rev.entry)).toFixed(2)})
                          </span>
                        )}
                      </div>

                      {/* Action buttons for PENDING_REVIEW */}
                      {isPending && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleReviewAction(rev.signalId, 'APPROVE')}
                            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve (Keep Levels)
                          </button>
                          <button
                            onClick={() => handleReviewAction(rev.signalId, 'REJECT')}
                            className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-mono text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 2: CURATED LESSONS (MAX 20, MAX 200 CHARS)                */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'LESSONS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-mono text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-[#E8B84A]" />
                Institutional Lessons Memory Bank (Admin-Curated)
              </h3>
              <p className="text-[11px] text-neutral-400 font-mono">
                Active: <span className="text-white font-bold">{activeLessonsCount}</span> / 20 Maximum. Lessons act as context hints only and cannot override technical rules or alter levels.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleFetchChangeLog}
                className="px-3 py-1.5 rounded-xl bg-neutral-850 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                Change Log
              </button>
              <button
                onClick={() => {
                  setEditingLessonId(null);
                  setLessonInsightText('');
                  setIsAddLessonOpen(true);
                }}
                disabled={activeLessonsCount >= 20}
                className="px-3.5 py-1.5 rounded-xl bg-[#E8B84A] text-neutral-950 font-mono text-xs font-bold hover:bg-[#FFD97A] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Curated Lesson
              </button>
            </div>
          </div>

          {/* Add / Edit Form Modal */}
          {isAddLessonOpen && (
            <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/40 bg-black/80 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <h4 className="font-mono text-xs font-bold text-white">
                  {editingLessonId ? 'Edit Curated Lesson' : 'Add New Curated Lesson (Max 200 chars)'}
                </h4>
                <button onClick={() => setIsAddLessonOpen(false)} className="text-neutral-400 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveCuratedLesson} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-neutral-400">Category</label>
                    <select
                      value={lessonCategory}
                      onChange={(e) => setLessonCategory(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-700 text-white rounded-lg p-2 font-mono text-xs"
                    >
                      <option value="LIQUIDITY_DYNAMICS">LIQUIDITY_DYNAMICS (Session Sweeps)</option>
                      <option value="SESSION_TIMING">SESSION_TIMING (London/NY Overlap)</option>
                      <option value="NEWS_IMPACT">NEWS_IMPACT (CPI/FOMC Volatility)</option>
                      <option value="RR_DISCIPLINE">RR_DISCIPLINE (SL Max $10.00 Rules)</option>
                      <option value="STRUCTURE_BIAS">STRUCTURE_BIAS (H4/H1 Confluence)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-neutral-400">
                      Lesson Text ({lessonInsightText.length} / 200 characters max)
                    </label>
                    <input
                      type="text"
                      maxLength={200}
                      value={lessonInsightText}
                      onChange={(e) => setLessonInsightText(e.target.value)}
                      placeholder="e.g. London open sweeps require 15m candle close confirmation..."
                      className="w-full bg-neutral-900 border border-neutral-700 text-white rounded-lg p-2 font-mono text-xs"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[10px] font-mono text-neutral-400">
                    * Automatically sanitized: scripts, links, and override instructions are stripped.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddLessonOpen(false)}
                      className="px-3 py-1.5 rounded-lg font-mono text-xs text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-lg bg-[#E8B84A] text-neutral-950 font-mono text-xs font-bold hover:bg-[#FFD97A]"
                    >
                      {editingLessonId ? 'Update Lesson' : 'Save Lesson'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* Lessons List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {learningItems.map((lesson) => (
              <div
                key={lesson.id}
                className={`glass-panel p-4 rounded-xl border transition-all ${
                  lesson.active ? 'border-white/10 bg-black/40' : 'border-neutral-800 bg-black/20 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                  <span className="text-[10px] font-mono font-bold text-[#FFD97A] px-2 py-0.5 rounded bg-[#E8B84A]/10 border border-[#E8B84A]/20">
                    {lesson.category}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleLessonActive(lesson)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-all cursor-pointer ${
                        lesson.active
                          ? 'bg-emerald-950/60 border-emerald-600/40 text-emerald-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                      }`}
                    >
                      {lesson.active ? 'Active' : 'Disabled'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingLessonId(lesson.id);
                        setLessonInsightText(lesson.insight);
                        setLessonCategory(lesson.category);
                        setIsAddLessonOpen(true);
                      }}
                      className="text-neutral-400 hover:text-white p-1"
                      title="Edit lesson"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteLesson(lesson.id)}
                      className="text-neutral-400 hover:text-rose-400 p-1"
                      title="Delete lesson"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs font-mono text-neutral-200 leading-relaxed mb-2">
                  "{lesson.insight}"
                </p>

                <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 pt-1 border-t border-white/5">
                  <span>Author: {lesson.author || 'SARRAF Lead'}</span>
                  <span>Confidence: {lesson.confidence}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 3: SAFETY TESTS SUITE (8 TESTS PASS/FAIL TABLE)           */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'TESTS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-mono text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Award className="w-4 h-4 text-[#E8B84A]" />
                Google Chat Integration Hardening Tests (8-Step Suite)
              </h3>
              <p className="text-[11px] text-neutral-400 font-mono">
                Deterministic validation verifying autonomy, lock releases, timeout safety, whitelist security, and token encryption.
              </p>
            </div>

            <button
              onClick={handleRunHardeningTests}
              disabled={isRunningTests}
              className="px-4 py-2 rounded-xl bg-[#E8B84A] text-neutral-950 font-mono text-xs font-bold hover:bg-[#FFD97A] transition-all flex items-center gap-2 cursor-pointer shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              {isRunningTests ? 'Executing 8 Safety Tests...' : 'Run All 8 Safety Tests'}
            </button>
          </div>

          {testReport && (
            <div className="space-y-4">
              {/* Overall Summary Card */}
              <div
                className={`glass-panel p-4 rounded-xl border flex items-center justify-between font-mono ${
                  testReport.overallStatus === 'PASS'
                    ? 'border-emerald-500/40 bg-emerald-950/20'
                    : 'border-rose-500/40 bg-rose-950/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  {testReport.overallStatus === 'PASS' ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <XCircle className="w-6 h-6 text-rose-400" />
                  )}
                  <div>
                    <div className="text-sm font-bold text-white">
                      OVERALL RESULT: {testReport.overallStatus} ({testReport.passed}/{testReport.totalTests} PASSED)
                    </div>
                    <div className="text-xs text-neutral-400">
                      Executed at {new Date(testReport.timestamp).toLocaleTimeString()} UTC
                    </div>
                  </div>
                </div>
              </div>

              {/* Pass / Fail Table */}
              <div className="glass-panel rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-black/60 text-neutral-400 border-b border-white/10">
                    <tr>
                      <th className="p-3">Test</th>
                      <th className="p-3">Specification</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Latency</th>
                      <th className="p-3">Verification Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {testReport.results.map((t: any) => (
                      <tr key={t.id} className="hover:bg-white/[0.02]">
                        <td className="p-3 font-bold text-white whitespace-nowrap">{t.id}</td>
                        <td className="p-3 text-neutral-300">{t.name}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              t.passed
                                ? 'bg-emerald-950/60 border border-emerald-600/40 text-emerald-300'
                                : 'bg-rose-950/60 border border-rose-600/40 text-rose-300'
                            }`}
                          >
                            {t.passed ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                        <td className="p-3 text-neutral-400 whitespace-nowrap">{t.durationMs}ms</td>
                        <td className="p-3 text-[11px] text-neutral-400">{t.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 4: GOOGLE CHAT SPACE MESSAGES                            */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'WAR_ROOM' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 glass-panel p-4 rounded-xl border border-white/10 space-y-3">
            <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
              <span>Google Chat Spaces</span>
              <button onClick={loadSpaces} className="text-neutral-400 hover:text-white">
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSpaces ? 'animate-spin' : ''}`} />
              </button>
            </h4>

            {spaces.length === 0 ? (
              <div className="text-neutral-500 font-mono text-xs py-4 text-center">
                {googleToken ? 'No spaces detected.' : 'Connect Google account to view spaces.'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {spaces.map((sp) => (
                  <button
                    key={sp.name}
                    onClick={() => setSelectedSpace(sp.name)}
                    className={`w-full text-left p-2.5 rounded-lg font-mono text-xs transition-all flex items-center justify-between ${
                      selectedSpace === sp.name
                        ? 'bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-[#FFD97A]'
                        : 'bg-black/30 border border-white/5 text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <span className="truncate">{sp.displayName || sp.name}</span>
                    <ArrowRight className="w-3 h-3 shrink-0 ml-1" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 glass-panel p-4 rounded-xl border border-white/10 flex flex-col h-[400px]">
            <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider pb-2 border-b border-white/10 flex items-center justify-between">
              <span>War Room Feed</span>
              <span className="text-[10px] text-neutral-500 font-normal">
                {selectedSpace ? selectedSpace : 'Select a space'}
              </span>
            </h4>

            <div className="flex-1 overflow-y-auto space-y-2 py-3">
              {messages.length === 0 ? (
                <div className="text-neutral-500 font-mono text-xs text-center py-10">
                  {isLoadingMessages ? 'Loading messages...' : 'No messages in this space yet.'}
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.name} className="bg-black/40 p-2.5 rounded-lg border border-white/5 text-xs font-mono">
                    <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-1">
                      <span className="font-bold text-white">{m.sender?.displayName || 'User'}</span>
                      <span>{new Date(m.createTime).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-neutral-200">{m.text}</div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="pt-2 border-t border-white/10 flex gap-2">
              <input
                type="text"
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
                placeholder="Post observation or setup feedback..."
                className="flex-1 bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-1.5 font-mono text-xs"
              />
              <button
                type="submit"
                disabled={isSendingMessage || !newMessageText.trim()}
                className="px-3 py-1.5 rounded-lg bg-[#E8B84A] text-neutral-950 font-mono text-xs font-bold hover:bg-[#FFD97A] disabled:opacity-50 cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Change Log Modal */}
      {isChangeLogOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel p-6 rounded-2xl border border-white/20 max-w-lg w-full max-h-[80vh] flex flex-col font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <h4 className="font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-[#E8B84A]" />
                Institutional Lessons Change Log
              </h4>
              <button onClick={() => setIsChangeLogOpen(false)} className="text-neutral-400 hover:text-white">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {changeLog.length === 0 ? (
                <div className="text-neutral-500 text-center py-6">No change log items recorded yet.</div>
              ) : (
                changeLog.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-lg bg-black/50 border border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span className="font-bold text-[#FFD97A]">{log.action}</span>
                      <span>{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="text-neutral-300">{log.details}</div>
                    <div className="text-[10px] text-neutral-500">By: {log.adminEmail}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
