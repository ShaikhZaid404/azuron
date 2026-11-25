import React, { useEffect, useState } from 'react';
import { AppShell, type NavRoute } from './components/AppShell.js';
import { AzuronStreamHubProvider } from './hub/StreamHubContext.js';
import { AccountsPage } from './pages/AccountsPage.js';
import { ChatPage } from './pages/ChatPage.js';
import { MarketplacePage } from './pages/MarketplacePage.js';
import { ModelsPage } from './pages/ModelsPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { StoragePage } from './pages/StoragePage.js';
import { TasksPage } from './pages/TasksPage.js';
import { TerminalPage } from './pages/TerminalPage.js';
import { UsagePage } from './pages/UsagePage.js';
import { WorkflowsPage } from './pages/WorkflowsPage.js';

export const App: React.FC = () => {
  const [route, setRoute] = useState<NavRoute>('overview');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('azuron-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('azuron-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <AzuronStreamHubProvider>
      <AppShell route={route} onNavigate={setRoute} theme={theme} onToggleTheme={toggleTheme}>
        {route === 'overview' && <OverviewPage onNavigate={setRoute} />}
        {route === 'chat' && <ChatPage />}
        {route === 'tasks' && <TasksPage />}
        {route === 'terminal' && <TerminalPage />}
        {route === 'models' && <ModelsPage />}
        {route === 'accounts' && <AccountsPage />}
        {route === 'marketplace' && <MarketplacePage />}
        {route === 'usage' && <UsagePage />}
        {route === 'storage' && <StoragePage />}
        {route === 'workflows' && <WorkflowsPage />}
        {route === 'settings' && <SettingsPage theme={theme} onToggleTheme={toggleTheme} />}
      </AppShell>
    </AzuronStreamHubProvider>
  );
};
