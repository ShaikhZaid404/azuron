import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, KeyRound, Mail, Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import type { Account, ByokKey, ByokProvider, IntegrationStatus, NativeProvider } from '@azuron/contract';
import { useStreamHub } from '../hub/StreamHubContext.js';
import { apiJson } from '../lib/api.js';

interface OAuthResult {
  ok: boolean;
  accountId: string;
  provider: NativeProvider;
  profilePath: string;
  command: string;
  oauthUrl: string | null;
  cliAvailable: boolean;
  email: string | null;
  message: string;
}

export const AccountsPage: React.FC = () => {
  const { subscribe } = useStreamHub();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [byokKeys, setByokKeys] = useState<ByokKey[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [oauthResult, setOauthResult] = useState<OAuthResult | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const [provider, setProvider] = useState<NativeProvider>('antigravity');
  const [accountName, setAccountName] = useState('');

  const [byokProvider, setByokProvider] = useState<ByokProvider>('groq');
  const [byokLabel, setByokLabel] = useState('');
  const [byokSecret, setByokSecret] = useState('');

  const [patName, setPatName] = useState<'github' | 'vercel' | 'rclone'>('github');
  const [patToken, setPatToken] = useState('');

  const load = async () => {
    const [a, b, i] = await Promise.all([
      apiJson<{ accounts: Account[] }>('/api/accounts'),
      apiJson<{ keys: ByokKey[] }>('/api/byok'),
      apiJson<{ integrations: IntegrationStatus[] }>('/api/integrations'),
    ]);
    setAccounts(a.accounts);
    setByokKeys(b.keys);
    setIntegrations(i.integrations);
  };

  useEffect(() => {
    void load();
  }, []);

  // Auto-refresh account list when background OAuth finishes and detects email
  useEffect(() => {
    return subscribe((ev) => {
      if (ev.type === 'system.log' && ev.payload?.kind === 'account.oauth') {
        void load();
      }
    });
  }, [subscribe]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim()) return;
    await apiJson('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, accountName: accountName.trim() }),
    });
    setAccountName('');
    await load();
  };

  const handleAddByok = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!byokLabel.trim() || !byokSecret.trim()) return;
    await apiJson('/api/byok', {
      method: 'POST',
      body: JSON.stringify({ provider: byokProvider, label: byokLabel.trim(), apiKey: byokSecret.trim() }),
    });
    setByokLabel('');
    setByokSecret('');
    await load();
  };

  const handleSavePat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patToken.trim()) return;
    await apiJson('/api/integrations', {
      method: 'POST',
      body: JSON.stringify({ name: patName, token: patToken.trim() }),
    });
    setPatToken('');
    await load();
  };

  const handleLaunchOAuth = async (accountId: string) => {
    setConnectingId(accountId);
    try {
      const json = await apiJson<OAuthResult>(`/api/accounts/${accountId}/oauth`, {
        method: 'POST',
      });
      setOauthResult(json);
      await load();
    } finally {
      setConnectingId(null);
    }
  };

  const handleSyncEmail = async (accountId: string) => {
    await apiJson(`/api/accounts/${accountId}/sync-email`, { method: 'POST', body: '{}' });
    await load();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Unified Connectors & Vault Hub</h1>
        <p className="text-xs opacity-80">
          Connect unlimited Antigravity and Codex accounts via browser OAuth, BYOK API keys, and GitHub/Vercel/rclone integrations
        </p>
      </div>

      {/* Native CLI N-Accounts */}
      <div className="p-4 rounded border space-y-4" style={{ borderColor: 'var(--az-border)' }}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus size={16} />
          <span>Native Provider Accounts (Google Antigravity & OpenAI Codex)</span>
        </div>

        <form onSubmit={(e) => void handleAddAccount(e)} className="flex flex-wrap gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as NativeProvider)}
            className="px-3 py-1.5 rounded border bg-transparent text-xs font-mono"
            style={{ borderColor: 'var(--az-border)' }}
          >
            <option value="antigravity" style={{ backgroundColor: 'var(--az-bg)' }}>antigravity (agy)</option>
            <option value="codex" style={{ backgroundColor: 'var(--az-bg)' }}>codex</option>
          </select>
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account label (e.g. Personal Google / Codex Pro)"
            className="flex-1 min-w-[200px] px-3 py-1.5 rounded border bg-transparent text-xs outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            <Plus size={14} />
            <span>Create Isolated Profile</span>
          </button>
        </form>

        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="p-3 rounded border flex flex-wrap items-center justify-between gap-2 text-xs" style={{ borderColor: 'var(--az-border)' }}>
              <div className="space-y-0.5">
                <div className="font-medium flex flex-wrap items-center gap-2">
                  <span>{acc.accountName}</span>
                  <span className="font-mono opacity-80">[{acc.provider}]</span>
                  {acc.accountEmail ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px]"
                      style={{ backgroundColor: 'rgba(139,92,246,0.16)', color: 'var(--az-accent)' }}
                    >
                      <Mail size={11} />
                      <span>{acc.accountEmail}</span>
                    </span>
                  ) : (
                    <span className="text-[11px] opacity-60">Not linked to email yet</span>
                  )}
                </div>
                <div className="font-mono opacity-75">{acc.authProfilePath}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void apiJson(`/api/accounts/${acc.id}/activate`, { method: 'POST' }).then(load)}
                  className="px-2.5 py-1 rounded border inline-flex items-center gap-1 cursor-pointer"
                  style={{
                    backgroundColor: acc.isActive ? 'var(--az-accent)' : 'transparent',
                    color: acc.isActive ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                    borderColor: acc.isActive ? 'var(--az-accent)' : 'var(--az-border)',
                  }}
                >
                  {acc.isActive && <Check size={12} />}
                  <span>{acc.isActive ? 'Active' : 'Activate'}</span>
                </button>
                <button
                  type="button"
                  disabled={connectingId === acc.id}
                  onClick={() => void handleLaunchOAuth(acc.id)}
                  className="px-2.5 py-1 rounded border inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  style={{ borderColor: 'var(--az-accent)', color: 'var(--az-accent)' }}
                  title="Generate browser OAuth link to sign in and select your account"
                >
                  <ExternalLink size={12} />
                  <span>{connectingId === acc.id ? 'Generating Link...' : 'Connect Browser'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSyncEmail(acc.id)}
                  className="p-1.5 rounded border cursor-pointer"
                  style={{ borderColor: 'var(--az-border)' }}
                  title="Sync connected email from profile"
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => void apiJson(`/api/accounts/${acc.id}`, { method: 'DELETE' }).then(load)}
                  className="p-1.5 rounded border cursor-pointer"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Browser OAuth Link Panel */}
        {oauthResult && (
          <div
            className="p-3.5 rounded border text-xs space-y-2"
            style={{ borderColor: 'var(--az-accent)', backgroundColor: 'rgba(139,92,246,0.08)' }}
          >
            <div className="font-semibold font-mono" style={{ color: 'var(--az-accent)' }}>
              {oauthResult.oauthUrl ? '[CHECK] Browser OAuth Link Ready' : '[INFO] OAuth Profile Status'}
            </div>
            <div className="opacity-90">{oauthResult.message}</div>
            {oauthResult.oauthUrl && (
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <a
                  href={oauthResult.oauthUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded font-semibold inline-flex items-center gap-1.5"
                  style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
                >
                  <ExternalLink size={13} />
                  <span>Open Login Link in Browser</span>
                </a>
                <span className="font-mono text-[11px] opacity-75 break-all">{oauthResult.oauthUrl}</span>
              </div>
            )}
            <div className="font-mono text-[11px] opacity-70">
              Profile: {oauthResult.profilePath}
            </div>
            <button
              type="button"
              onClick={() => setOauthResult(null)}
              className="text-xs opacity-60 cursor-pointer underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* BYOK Keys */}
      <div className="p-4 rounded border space-y-4" style={{ borderColor: 'var(--az-border)' }}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound size={16} />
          <span>Third-Party BYOK API Keys (Encrypted AES-256-GCM)</span>
        </div>

        <form onSubmit={(e) => void handleAddByok(e)} className="flex flex-wrap gap-2">
          <select
            value={byokProvider}
            onChange={(e) => setByokProvider(e.target.value as ByokProvider)}
            className="px-3 py-1.5 rounded border bg-transparent text-xs font-mono"
            style={{ borderColor: 'var(--az-border)' }}
          >
            {(['groq', 'openrouter', 'anthropic', 'deepseek', 'google_ai_studio'] as ByokProvider[]).map((p) => (
              <option key={p} value={p} style={{ backgroundColor: 'var(--az-bg)' }}>{p}</option>
            ))}
          </select>
          <input
            value={byokLabel}
            onChange={(e) => setByokLabel(e.target.value)}
            placeholder="Label"
            className="px-3 py-1.5 rounded border bg-transparent text-xs outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <input
            type="password"
            value={byokSecret}
            onChange={(e) => setByokSecret(e.target.value)}
            placeholder="API Key"
            className="flex-1 min-w-[180px] px-3 py-1.5 rounded border bg-transparent text-xs font-mono outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            Save Key
          </button>
        </form>

        <div className="space-y-2">
          {byokKeys.map((k) => (
            <div key={k.id} className="p-2.5 rounded border flex items-center justify-between text-xs" style={{ borderColor: 'var(--az-border)' }}>
              <span className="font-mono">
                {k.provider} • {k.label} ({k.maskedKey})
              </span>
              <button
                type="button"
                onClick={() => void apiJson(`/api/byok/${k.id}`, { method: 'DELETE' }).then(load)}
                className="p-1.5 rounded border cursor-pointer"
                style={{ borderColor: 'var(--az-border)' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Developer Integrations */}
      <div className="p-4 rounded border space-y-4" style={{ borderColor: 'var(--az-border)' }}>
        <div className="text-sm font-semibold">Developer & Cloud Backup Integrations</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {integrations.map((intg) => (
            <div key={intg.name} className="p-3 rounded border text-xs space-y-1" style={{ borderColor: 'var(--az-border)' }}>
              <div className="flex items-center justify-between font-semibold uppercase">
                <span>{intg.name}</span>
                <span style={{ color: intg.connected ? 'var(--az-accent)' : 'var(--az-fg)' }}>
                  {intg.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="opacity-80">{intg.accountLabel ?? intg.details}</div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => void handleSavePat(e)} className="flex flex-wrap gap-2">
          <select
            value={patName}
            onChange={(e) => setPatName(e.target.value as 'github' | 'vercel' | 'rclone')}
            className="px-3 py-1.5 rounded border bg-transparent text-xs font-mono"
            style={{ borderColor: 'var(--az-border)' }}
          >
            <option value="github" style={{ backgroundColor: 'var(--az-bg)' }}>github</option>
            <option value="vercel" style={{ backgroundColor: 'var(--az-bg)' }}>vercel</option>
            <option value="rclone" style={{ backgroundColor: 'var(--az-bg)' }}>rclone</option>
          </select>
          <input
            type="password"
            value={patToken}
            onChange={(e) => setPatToken(e.target.value)}
            placeholder="Personal Access Token"
            className="flex-1 min-w-[200px] px-3 py-1.5 rounded border bg-transparent text-xs font-mono outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            Save Token
          </button>
        </form>
      </div>
    </div>
  );
};
