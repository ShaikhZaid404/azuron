import React, { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { ModelDescriptor } from '@azuron/contract';
import { apiJson } from '../lib/api.js';

export const ModelsPage: React.FC = () => {
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    setRefreshing(true);
    try {
      const res = await apiJson<{ models: ModelDescriptor[] }>(`/api/models${refresh ? '?refresh=1' : ''}`);
      setModels(res.models);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const filtered = models.filter(
    (m) =>
      m.displayName.toLowerCase().includes(query.toLowerCase()) ||
      m.provider.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dynamic Model Center</h1>
          <p className="text-xs opacity-80">Live entitlements discovered from active CLIs and BYOK keys (zero hardcoding)</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          className="px-3 py-1.5 rounded text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
        >
          <RefreshCw size={14} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh Models'}</span>
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded border" style={{ borderColor: 'var(--az-border)' }}>
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter models by name or provider..."
          className="w-full bg-transparent text-xs outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="p-6 rounded border text-xs opacity-80" style={{ borderColor: 'var(--az-border)' }}>
          No live models discovered yet. Connect an Antigravity/Codex profile or add a BYOK API key under Connectors.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((m) => (
            <div key={`${m.provider}-${m.accountId}-${m.id}`} className="p-4 rounded border space-y-2" style={{ borderColor: 'var(--az-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold truncate">{m.displayName}</span>
                <span className="px-2 py-0.5 rounded border text-[11px] font-mono uppercase" style={{ borderColor: 'var(--az-border)' }}>
                  {m.status}
                </span>
              </div>
              <div className="text-xs font-mono opacity-80">
                {m.provider} {m.accountName ? `• ${m.accountName}` : ''}
              </div>
              {m.supportedReasoningEfforts.length > 0 && (
                <div className="text-[11px] font-mono">
                  Reasoning: {m.supportedReasoningEfforts.join(' / ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
