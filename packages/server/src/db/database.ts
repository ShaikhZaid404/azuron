import { DatabaseSync } from 'node:sqlite';
import { AZURON_RETENTION_DEFAULTS } from '@azuron/contract';

export function openAzuronDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  applySchema(db);
  seedRetentionPolicies(db);
  return db;
}

function applySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('antigravity', 'codex')),
      account_name TEXT NOT NULL,
      auth_profile_path TEXT,
      encrypted_credentials TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unverified',
      token_usage_cached TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS byok_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('openrouter', 'groq', 'anthropic', 'deepseek', 'google_ai_studio')),
      label TEXT NOT NULL,
      masked_key TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      name TEXT PRIMARY KEY CHECK(name IN ('github', 'vercel', 'rclone')),
      encrypted_token TEXT,
      account_label TEXT,
      details TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filesystem_path TEXT NOT NULL UNIQUE,
      base_branch TEXT NOT NULL DEFAULT 'main',
      tags TEXT,
      instructions TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'auto',
      title TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      last_activity_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_activity ON conversations(last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      tool_calls_json TEXT,
      attachments_json TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_cached INTEGER DEFAULT 0,
      cost_reported REAL DEFAULT 0.0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'review', 'done', 'failed', 'cancelled')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      worktree_path TEXT,
      branch_name TEXT,
      diff_stat TEXT,
      peak_memory_mb REAL DEFAULT 0.0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      settled_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

    CREATE TABLE IF NOT EXISTS terminal_commands (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_prompt TEXT NOT NULL,
      compiled_command TEXT NOT NULL,
      explanation TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('safe', 'moderate', 'destructive')),
      approval_status TEXT NOT NULL CHECK(approval_status IN ('pending', 'approved', 'rejected')),
      exit_code INTEGER,
      output_log TEXT,
      executed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_cached INTEGER DEFAULT 0,
      cost_reported REAL,
      recorded_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_recorded_at ON usage_records(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_records(provider);

    CREATE TABLE IF NOT EXISTS retention_policies (
      category TEXT PRIMARY KEY,
      retention_days INTEGER NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      last_cleaned_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS stream_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stream_events_created ON stream_events(created_at DESC);
  `);
}

function seedRetentionPolicies(db: DatabaseSync): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO retention_policies (category, retention_days, is_enabled, last_cleaned_at)
    VALUES (?, ?, 1, NULL)
  `);
  for (const [category, days] of Object.entries(AZURON_RETENTION_DEFAULTS)) {
    stmt.run(category, days);
  }
}
