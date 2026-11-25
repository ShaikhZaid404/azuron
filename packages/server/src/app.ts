import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { AzuronEnvironmentInspector } from './core/environment.js';
import { AzuronLogger } from './core/logger.js';
import { ensureAzuronDirectories, resolveAzuronPaths, type AzuronPaths } from './core/paths.js';
import { AzuronStreamHub } from './core/stream-hub.js';
import { AzuronAccountVault } from './core/vault.js';
import { openAzuronDatabase } from './db/database.js';
import { createApiRouter, type AzuronServices } from './routes/api.js';
import { AzuronAiTerminal } from './services/ai-terminal.js';
import { AzuronAnalyticsService } from './services/analytics.js';
import { AzuronChatManager } from './services/chat-manager.js';
import { AzuronCloudBackupService } from './services/cloud-backup.js';
import { AzuronModelCenter } from './services/model-center.js';
import { AzuronStorageRetentionEngine } from './services/storage-retention.js';
import { AzuronTaskManager } from './services/task-manager.js';
import { AzuronWorkflowEngine } from './services/workflow-engine.js';

export interface AzuronAppContext {
  app: Hono;
  db: DatabaseSync;
  paths: AzuronPaths;
  services: AzuronServices;
  close: () => void;
}

export function createAzuronApp(opts?: {
  customHomeDir?: string;
  workspaceRoot?: string;
  silentLogs?: boolean;
}): AzuronAppContext {
  const paths = resolveAzuronPaths(opts?.customHomeDir);
  ensureAzuronDirectories(paths);

  const logger = new AzuronLogger(opts?.silentLogs ? null : paths.logFilePath);
  const db = openAzuronDatabase(paths.dbPath);
  const hub = new AzuronStreamHub(db);
  const vault = new AzuronAccountVault(db, paths);
  const env = new AzuronEnvironmentInspector();
  const chats = new AzuronChatManager(db, paths, vault, hub);
  const models = new AzuronModelCenter(vault, env);
  const terminal = new AzuronAiTerminal(db, hub);
  const storage = new AzuronStorageRetentionEngine(db, paths);
  const analytics = new AzuronAnalyticsService(db);
  const tasks = new AzuronTaskManager(db, hub);
  const workflows = new AzuronWorkflowEngine(hub);
  const backup = new AzuronCloudBackupService(paths);

  const workspaceRoot = opts?.workspaceRoot || path.resolve(import.meta.dirname, '../../../..');
  const services: AzuronServices = {
    paths,
    logger,
    hub,
    vault,
    env,
    chats,
    models,
    terminal,
    storage,
    analytics,
    tasks,
    workflows,
    backup,
    startedAt: Date.now(),
    workspaceRoot,
  };

  const app = new Hono();
  app.route('/api', createApiRouter(services));

  // Serve official AZURON brand emblem
  app.get('/brand/azuron-logo.webp', (c) => {
    const logoPath = path.join(workspaceRoot, 'docs', 'brand', 'azuron-logo.webp');
    if (!fs.existsSync(logoPath)) {
      return c.text('Logo not found', 404);
    }
    const bytes = fs.readFileSync(logoPath);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  // Serve built Vite SPA in production
  const webDistDir = path.join(workspaceRoot, 'packages', 'web', 'dist');
  app.get('*', (c) => {
    const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
    const candidate = path.join(webDistDir, reqPath);
    const safeCandidate = candidate.startsWith(webDistDir) ? candidate : null;

    if (safeCandidate && fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile()) {
      return new Response(fs.readFileSync(safeCandidate), {
        headers: { 'Content-Type': contentTypeFor(safeCandidate) },
      });
    }

    const indexHtml = path.join(webDistDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return new Response(fs.readFileSync(indexHtml), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return c.json({
      name: 'AZURON',
      message: 'AZURON backend is running. Build @azuron/web to serve the dashboard SPA.',
    });
  });

  return {
    app,
    db,
    paths,
    services,
    close: () => {
      db.close();
    },
  };
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
