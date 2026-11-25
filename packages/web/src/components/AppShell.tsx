import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Cpu,
  FolderGit2,
  GitMerge,
  HardDrive,
  KeyRound,
  Layers,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  Store,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import { useStreamHub } from '../hub/StreamHubContext.js';

export type NavRoute =
  | 'overview'
  | 'chat'
  | 'terminal'
  | 'tasks'
  | 'models'
  | 'accounts'
  | 'usage'
  | 'storage'
  | 'workflows'
  | 'marketplace'
  | 'settings';

interface AppShellProps {
  route: NavRoute;
  onNavigate: (route: NavRoute) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ id: NavRoute; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: Layers },
  { id: 'workflows', label: 'Workflows', icon: GitMerge },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'accounts', label: 'Connectors', icon: KeyRound },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const AppShell: React.FC<AppShellProps> = ({
  route,
  onNavigate,
  theme,
  onToggleTheme,
  children,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { connected, activeRuns } = useStreamHub();

  const mobilePrimary: NavRoute[] = ['overview', 'chat', 'terminal', 'tasks'];

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: 'var(--az-bg)', color: 'var(--az-fg)' }}
    >
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex md:w-60 md:flex-col border-r shrink-0"
        style={{ borderColor: 'var(--az-border)', backgroundColor: 'var(--az-bg)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <div className="flex items-center gap-2.5">
            <img
              src="/brand/azuron-logo.webp"
              alt="AZURON"
              className="w-7 h-7 rounded border object-cover"
              style={{ borderColor: 'var(--az-border)' }}
            />
            <span className="font-semibold tracking-wide text-sm">AZURON</span>
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            title="Toggle Dark/Light Theme"
            className="p-2 rounded border cursor-pointer"
            style={{ borderColor: 'var(--az-border)', color: 'var(--az-fg)' }}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-left cursor-pointer border"
                style={{
                  backgroundColor: active ? 'var(--az-accent)' : 'transparent',
                  color: active ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                  borderColor: active ? 'var(--az-accent)' : 'transparent',
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div
          className="px-4 py-3 border-t text-xs flex items-center justify-between"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <span className="flex items-center gap-2">
            <FolderGit2 size={14} />
            <span>127.0.0.1:45160</span>
          </span>
          <span
            className="px-2 py-0.5 rounded border font-mono text-[11px]"
            style={{
              borderColor: connected ? 'var(--az-accent)' : 'var(--az-border)',
              color: connected ? 'var(--az-accent)' : 'var(--az-fg)',
            }}
          >
            {connected ? 'LIVE' : 'RETRY'}
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mobile Top Bar */}
        <header
          className="md:hidden flex items-center justify-between px-3 py-2 border-b shrink-0"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <div className="flex items-center gap-2">
            <img
              src="/brand/azuron-logo.webp"
              alt="AZURON"
              className="w-6 h-6 rounded border object-cover"
              style={{ borderColor: 'var(--az-border)' }}
            />
            <span className="font-semibold text-sm tracking-wide">AZURON</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded border font-mono text-[11px]"
              style={{
                borderColor: connected ? 'var(--az-accent)' : 'var(--az-border)',
                color: connected ? 'var(--az-accent)' : 'var(--az-fg)',
              }}
            >
              {connected ? 'LIVE' : 'RETRY'}
            </span>
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-2 rounded border cursor-pointer"
              style={{ borderColor: 'var(--az-border)', color: 'var(--az-fg)' }}
              aria-label="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 md:p-6 pb-24 md:pb-6">{children}</main>

        {/* Global Floating In-Flight Mini-Runner Bar (Zero-Loss Navigation) */}
        {activeRuns.length > 0 && (
          <div
            className="mx-3 mb-16 md:mb-3 px-3 py-2 rounded border flex items-center justify-between gap-3 text-xs shrink-0"
            style={{
              backgroundColor: 'var(--az-bg)',
              borderColor: 'var(--az-accent)',
              color: 'var(--az-fg)',
            }}
          >
            <div className="truncate font-mono">
              [ACTIVE RUN] {activeRuns[0]!.title} — {activeRuns[0]!.step}
            </div>
            <button
              type="button"
              onClick={() => onNavigate(activeRuns[0]!.kind === 'task' ? 'tasks' : 'chat')}
              className="px-2.5 py-1 rounded font-medium shrink-0 cursor-pointer"
              style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
            >
              Return
            </button>
          </div>
        )}

        {/* Mobile Bottom Navigation */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around border-t py-1.5 z-30"
          style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
        >
          {mobilePrimary.map((id) => {
            const item = NAV_ITEMS.find((n) => n.id === id)!;
            const Icon = item.icon;
            const active = route === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  onNavigate(id);
                }}
                className="flex flex-col items-center justify-center px-3 py-1 rounded text-[11px] min-w-[56px] cursor-pointer"
                style={{
                  color: active ? 'var(--az-accent)' : 'var(--az-fg)',
                }}
              >
                <Icon size={18} />
                <span className="mt-0.5">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="flex flex-col items-center justify-center px-3 py-1 rounded text-[11px] min-w-[56px] cursor-pointer"
            style={{ color: drawerOpen ? 'var(--az-accent)' : 'var(--az-fg)' }}
          >
            {drawerOpen ? <X size={18} /> : <Menu size={18} />}
            <span className="mt-0.5">Menu</span>
          </button>
        </nav>
      </div>

      {/* Mobile Drawer for Secondary Routes */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 flex flex-col justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="border-t p-4 pb-20 space-y-2"
            style={{ backgroundColor: 'var(--az-bg)', borderColor: 'var(--az-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--az-border)' }}>
              <span className="text-sm font-semibold">Workspace Sections</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded border cursor-pointer"
                style={{ borderColor: 'var(--az-border)' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {NAV_ITEMS.filter((i) => !mobilePrimary.includes(i.id)).map((item) => {
                const Icon = item.icon;
                const active = route === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setDrawerOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 rounded border text-sm cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--az-accent)' : 'transparent',
                      color: active ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                      borderColor: active ? 'var(--az-accent)' : 'var(--az-border)',
                    }}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
