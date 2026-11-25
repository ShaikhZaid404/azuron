/**
 * AZURON Shared Constants & Design System Tokens
 *
 * Notice: Contract architecture patterns adapted from open-mercato/cezar (MIT License, (c) Patryk Lewczuk).
 */

export const AZURON_APP_NAME = 'AZURON';
export const AZURON_DEFAULT_HOST = '127.0.0.1';
export const AZURON_DEFAULT_PORT = 45160;
export const AZURON_RESERVED_PORTS = [45157, 45158] as const;
export const AZURON_MAX_HEAP_MB = 256;

export const NATIVE_PROVIDERS = ['antigravity', 'codex'] as const;
export const BYOK_PROVIDERS = [
  'openrouter',
  'groq',
  'anthropic',
  'deepseek',
  'google_ai_studio',
] as const;

export const EXECUTION_MODES = ['plan', 'code', 'beast', 'auto'] as const;
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

/**
 * Strict 70-20-8-2 Theme Distribution (Anti-AI-Slop Standard)
 */
export const AZURON_THEME_TOKENS = {
  dark: {
    background: '#0D0D0D', // 70%
    foreground: '#FFFFFF', // 20%
    accent: '#8B5CF6',     // 8%
    border: '#2B2B2B',     // 2%
  },
  light: {
    background: '#FFFFFF', // 70%
    foreground: '#0D0D0D', // 20%
    accent: '#8B5CF6',     // 8%
    border: '#E5E7EB',     // 2%
  },
} as const;

export const AZURON_RETENTION_DEFAULTS = {
  task_logs: 7,
  inactive_chats: 30,
  temp_files: 2,
  usage_history: 365,
} as const;

export const AZURON_CHAT_PAGE_SIZE = 30;
export const AZURON_MIN_FREE_DISK_GB = 3;
export const AZURON_MAX_PARALLEL_WORKTREES_ANDROID = 2;
