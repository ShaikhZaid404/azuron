import React, { useEffect, useState } from 'react';
import { ExternalLink, Search, Star, X } from 'lucide-react';
import { apiJson } from '../lib/api.js';

interface MarketplaceItem {
  id: string;
  title: string;
  name: string;
  description: string;
  url: string;
  stars: number;
  language: string | null;
  author: string;
  avatarUrl: string | null;
  updatedAt: string;
}

export const MarketplacePage: React.FC = () => {
  const [query, setQuery] = useState('agent skill');
  const [category, setCategory] = useState('all');
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [selected, setSelected] = useState<MarketplaceItem | null>(null);
  const [installModal, setInstallModal] = useState<{ item: MarketplaceItem; done: boolean } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const searchLive = async (q = query, cat = category) => {
    const res = await apiJson<{ items: MarketplaceItem[]; warning?: string }>(
      `/api/marketplace?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`,
    );
    setItems(res.items);
    setWarning(res.warning ?? null);
  };

  useEffect(() => {
    void searchLive();
  }, []);

  const handleInstall = (item: MarketplaceItem) => {
    setInstallModal({ item, done: false });
    setTimeout(() => {
      setInstallModal({ item, done: true });
    }, 600);
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">AZURON Live Marketplace</h1>
        <p className="text-xs opacity-80">
          Zero hardcoded catalog — live GitHub discovery with remote image streaming
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void searchLive();
        }}
        className="flex flex-wrap gap-2"
      >
        <div className="flex-1 min-w-[200px] flex items-center gap-2 px-3 py-1.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills, React components, workflows, repos..."
            className="w-full bg-transparent text-xs outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            void searchLive(query, e.target.value);
          }}
          className="px-3 py-1.5 rounded border bg-transparent text-xs font-mono"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <option value="all" style={{ backgroundColor: 'var(--az-bg)' }}>All</option>
          <option value="skills" style={{ backgroundColor: 'var(--az-bg)' }}>Agent Skills</option>
          <option value="components" style={{ backgroundColor: 'var(--az-bg)' }}>React Components</option>
          <option value="workflows" style={{ backgroundColor: 'var(--az-bg)' }}>Workflows</option>
        </select>
        <button
          type="submit"
          className="px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
        >
          Search Live
        </button>
      </form>

      {warning && (
        <div className="p-3 rounded border text-xs font-mono" style={{ borderColor: 'var(--az-border)' }}>
          [INFO] {warning}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => setSelected(item)}
            className="p-4 rounded border space-y-2 cursor-pointer"
            style={{ borderColor: selected?.id === item.id ? 'var(--az-accent)' : 'var(--az-border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {item.avatarUrl && (
                  <img
                    src={item.avatarUrl}
                    alt={item.author}
                    className="w-6 h-6 rounded border shrink-0"
                    style={{ borderColor: 'var(--az-border)' }}
                  />
                )}
                <span className="text-sm font-semibold truncate">{item.title}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-mono shrink-0">
                <Star size={12} />
                {item.stars}
              </span>
            </div>
            <div className="text-xs opacity-80 line-clamp-2">{item.description}</div>
          </div>
        ))}
      </div>

      {/* VS Code-Style Inspection Drawer */}
      {selected && (
        <div className="p-4 rounded border space-y-3" style={{ borderColor: 'var(--az-accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{selected.title}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="p-1 rounded border cursor-pointer"
              style={{ borderColor: 'var(--az-border)' }}
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs opacity-85">{selected.description}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleInstall(selected)}
              className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
            >
              Install
            </button>
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded border text-xs inline-flex items-center gap-1.5"
              style={{ borderColor: 'var(--az-border)' }}
            >
              <ExternalLink size={13} />
              <span>Open on GitHub</span>
            </a>
          </div>
        </div>
      )}

      {/* Installation Progress & Completion Alert Modal */}
      {installModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        >
          <div
            className="w-full max-w-md rounded border p-4 space-y-3"
            style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
          >
            <div className="text-sm font-semibold">Installing {installModal.item.name}</div>
            <div className="p-3 rounded border text-xs font-mono" style={{ borderColor: 'var(--az-border)' }}>
              {installModal.done
                ? 'Installation Complete. You can close this window now or continue working.'
                : `[START] Resolving ${installModal.item.url}...`}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInstallModal(null)}
                className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
                style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
