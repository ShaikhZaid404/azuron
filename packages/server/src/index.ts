import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { AZURON_DEFAULT_HOST, AZURON_DEFAULT_PORT } from '@azuron/contract';
import { createAzuronApp } from './app.js';

const port = Number(process.env.AZURON_PORT || AZURON_DEFAULT_PORT);
const host = AZURON_DEFAULT_HOST;

const ctx = createAzuronApp();

// Startup retention sweep (Android background optimization friendly)
const cleanup = ctx.services.storage.runCleanup({ dryRun: false });

fs.writeFileSync(ctx.paths.pidPath, String(process.pid), 'utf8');

const server = serve(
  {
    fetch: ctx.app.fetch,
    hostname: host,
    port,
  },
  (info) => {
    const url = `http://${host}:${info.port}`;
    const accounts = ctx.services.vault.listAccounts();
    const byok = ctx.services.vault.listByokKeys();

    ctx.services.logger.banner([
      'AZURON — Local-First AI Coding Workspace',
      `Dashboard URL : ${url}`,
      `SQLite (WAL)  : ${ctx.paths.dbPath}`,
      `Accounts      : ${accounts.length} native | ${byok.length} BYOK`,
      `PID           : ${process.pid}`,
    ]);

    ctx.services.logger.log('START', `Listening strictly on loopback ${url}`);
    ctx.services.logger.log('CHECK', 'Startup retention sweep completed', {
      archivedChats: cleanup.archivedChatsCount,
      deletedTasks: cleanup.deletedTasksCount,
      freedBytes: cleanup.freedBytes,
    });
  },
);

const shutdown = () => {
  ctx.services.logger.log('INFO', 'Shutting down AZURON daemon');
  if (fs.existsSync(ctx.paths.pidPath)) {
    fs.unlinkSync(ctx.paths.pidPath);
  }
  server.close(() => {
    ctx.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
