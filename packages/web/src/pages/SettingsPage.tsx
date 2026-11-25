import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { apiJson } from '../lib/api.js';

interface SettingsPageProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ theme, onToggleTheme }) => {
  const [agentsMd, setAgentsMd] = useState('');
  const [agentsPath, setAgentsPath] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    void apiJson<{ path: string; content: string }>('/api/instructions')
      .then((d) => {
        setAgentsPath(d.path);
        setAgentsMd(d.content);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    await apiJson('/api/instructions', {
      method: 'PUT',
      body: JSON.stringify({ content: agentsMd }),
    });
    setSavedNotice('Saved AGENTS.md');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Settings & Instructions Editor</h1>
        <p className="text-xs opacity-80">Strict 70-20-8-2 theme configuration and self-refining AGENTS.md editor</p>
      </div>

      <div className="p-4 rounded border flex items-center justify-between" style={{ borderColor: 'var(--az-border)' }}>
        <div>
          <div className="text-sm font-semibold">Theme Mode ({theme.toUpperCase()})</div>
          <div className="text-xs opacity-80">
            Dark: #0D0D0D / #FFFFFF / #8B5CF6 / #2B2B2B | Light: #FFFFFF / #0D0D0D / #8B5CF6 / #E5E7EB
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
        >
          Switch to {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      <div className="p-4 rounded border space-y-3" style={{ borderColor: 'var(--az-border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Workspace AGENTS.md</div>
            <div className="text-xs font-mono opacity-75">{agentsPath}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="px-3 py-1.5 rounded text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            <Save size={13} />
            <span>{savedNotice ?? 'Save AGENTS.md'}</span>
          </button>
        </div>
        <textarea
          value={agentsMd}
          onChange={(e) => setAgentsMd(e.target.value)}
          rows={14}
          className="w-full p-3 rounded border bg-transparent text-xs font-mono outline-none"
          style={{ borderColor: 'var(--az-border)' }}
        />
      </div>
    </div>
  );
};
