import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { StartDriver } from './types.ts';

/**
 * Antigravity login driver:
 * 1. Automatically checks if a local Google OAuth token exists (~/.gemini/jetski-standalone-oauth-token).
 * 2. If 'key', accepts a Gemini API key (from Google AI Studio) or Google OAuth token.
 * 3. If 'browser', provides the direct Google AI Studio / Google OAuth link.
 */
export const startAntigravityLogin: StartDriver = (ctl) => {
  let disposed = false;

  // 1. Check if local Google OAuth token already exists on this Android / Termux device
  const localTokenPath = join(homedir(), '.gemini', 'jetski-standalone-oauth-token');
  if (ctl.method !== 'key' && existsSync(localTokenPath)) {
    try {
      const content = JSON.parse(readFileSync(localTokenPath, 'utf8'));
      if (content.token || content.id_token) {
        const profileDir = join(homedir(), '.azuron', 'profiles', 'antigravity');
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'token.json'), JSON.stringify(content, null, 2));
        ctl.update({ phase: 'verifying' });
        setTimeout(() => {
          if (!disposed && !ctl.done()) {
            ctl.succeed();
          }
        }, 300);
        return {
          dispose: () => {
            disposed = true;
          },
        };
      }
    } catch {
      // Fall through to key or browser flow
    }
  }

  // 2. Key method
  if (ctl.method === 'key') {
    ctl.update({ method: 'key', phase: 'needs-input' });
  } else {
    // Browser flow: direct Google authorization / AI Studio page
    ctl.update({
      method: 'browser',
      phase: 'waiting',
      url: 'https://aistudio.google.com/app/apikey',
    });
  }

  return {
    input: async (body) => {
      if (!('apiKey' in body)) {
        return { ok: false, status: 400, error: 'Expected apiKey in input.' };
      }
      const key = body.apiKey.trim();
      if (!key) {
        return { ok: false, status: 400, error: 'API key cannot be empty.' };
      }
      try {
        process.env.GEMINI_API_KEY = key;
        process.env.GOOGLE_API_KEY = key;
        process.env.AZURON_ANTIGRAVITY_KEY = key;
        const profileDir = join(homedir(), '.azuron', 'profiles', 'antigravity');
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'token.json'), JSON.stringify({ key, type: 'api_key', connectedAt: new Date().toISOString() }, null, 2));
        ctl.update({ phase: 'verifying' });
        ctl.succeed();
        return { ok: true };
      } catch (err) {
        return { ok: false, status: 400, error: String(err) };
      }
    },
    dispose: () => {
      disposed = true;
    },
  };
};
