# AZURON

> Local-first AI coding agent workspace — built for Android (Termux) and Linux.

AZURON is a self-hosted, privacy-first AI development workspace that runs entirely on your own device. It supports Google Antigravity (`agy`) and OpenAI Codex (`codex`) as native providers, unlimited account profiles, BYOK API keys, git worktree isolation, multi-step workflow pipelines, cloud backup via rclone, and a full React dashboard — all with your data stored locally under `~/.azuron/`.

---

## Features

- **Native provider support** — Google Antigravity (`agy`) and OpenAI Codex (`codex`), unlimited isolated profiles each
- **BYOK API keys** — Groq, OpenRouter, Anthropic, DeepSeek, Google AI Studio (AES-256-GCM encrypted)
- **100% local chat storage** — `~/.azuron/chats/` owns all history (like `.codex`, `.agy`, `.claude`)
- **Zero-copy attachments** — file paths referenced directly, never duplicated
- **AI Terminal** — NL-to-shell compiler, 3-tier risk gate, destructive CONFIRM double-gate
- **Git Worktree isolation** — each task gets its own branch + worktree; Review Gate with Approve & Merge / Reject
- **Workflow pipelines** — multi-step shell/agent pipelines with retry loops, live SSE progress
- **Cloud backup** — rclone push (Dropbox, Google Drive, S3, SFTP, etc.)
- **Smart storage retention** — activity-based cleanup, pin/protect (`Keep Forever`)
- **React 19 dashboard** — mobile-first, dark/light, 70-20-8-2 design system
- **Android/Termux native** — no `bwrap`, no native C++ addons, `node:sqlite` WAL, 256 MB V8 heap cap

---

## Requirements

| Requirement | Minimum |
|-------------|---------|
| Node.js | v22+ (v26 recommended) |
| npm | v9+ |
| git | any recent version |
| Termux (Android) | latest from F-Droid |
| rclone | optional (for cloud backup) |
| gh | optional (GitHub integration) |

---

## Installation (Termux / Android)

```bash
# 1. Install Node.js and git
pkg update && pkg install nodejs git

# 2. Clone the repository
git clone https://github.com/ShaikhZaid404/azuron.git "$HOME/azuron"
cd "$HOME/azuron"

# 3. Run the installer (builds everything + creates ~/.azuron/ + installs global command)
sh install.sh

# 4. Start AZURON
azuron start
```

Open the dashboard at **http://127.0.0.1:45160** in your browser.

---

## Installation (Linux / Desktop)

```bash
# 1. Make sure Node.js >= 22 is installed (https://nodejs.org)
node --version  # should print v22+ 

# 2. Clone
git clone https://github.com/ShaikhZaid404/azuron.git "$HOME/azuron"
cd "$HOME/azuron"

# 3. Install
sh install.sh

# 4. Add ~/.local/bin to PATH if not already (add to ~/.bashrc or ~/.zshrc)
export PATH="$HOME/.local/bin:$PATH"

# 5. Start
azuron start
```

---

## Directory Layout After Install

```
~/.azuron/
├── azuron.db             — SQLite WAL database (all state)
├── config.json           — Runtime config (port, theme, provider defaults)
├── master.key            — AES-256-GCM vault master key (chmod 600)
├── azuron.pid            — PID file (while server is running)
├── azuron.log            — Rotating log (5 MB max)
├── chats/
│   ├── global/           — All global conversations
│   │   └── <conv_id>/
│   │       ├── meta.json
│   │       └── messages.jsonl
│   └── projects/         — Project-scoped conversations
├── profiles/
│   ├── antigravity/      — Isolated agy auth profiles (one per account)
│   └── codex/            — Isolated codex auth profiles
├── logs/                 — Additional service logs
└── tmp/                  — Temporary files (auto-cleaned)
```

---

## CLI Commands

```bash
azuron start                    # Start the AZURON server (port 45160)
azuron stop                     # Stop the running server
azuron restart                  # Restart server
azuron status                   # Show PID, uptime, port
azuron doctor                   # Environment diagnostic (Node, git, agy, codex, rclone)
azuron storage clean --dry-run  # Preview storage cleanup (does not delete)
azuron storage clean            # Apply cleanup (respects pinned/protected items)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AZURON_HOME` | `~/.azuron` | Data directory |
| `AZURON_PORT` | `45160` | Server port |
| `AZURON_AGY_BIN` | `agy` | Path to Antigravity CLI binary |
| `AZURON_CODEX_BIN` | `codex` | Path to Codex CLI binary |
| `AZURON_NODE_BIN` | *(auto)* | Path to Node.js binary (auto-detected) |

---

## Connecting Providers

### Google Antigravity (`agy`)

```bash
# 1. Add account via dashboard (Connectors page) → "Create Isolated Profile"
# 2. Click "Launch OAuth" to get the command
# 3. Run in Termux:
AZURON_PROFILE_DIR=~/.azuron/profiles/antigravity/<account_id> agy auth login
```

### OpenAI Codex (`codex`)

```bash
# Same flow — Dashboard → Connectors → Create Isolated Profile → Launch OAuth
CODEX_HOME=~/.azuron/profiles/codex/<account_id> codex login
```

### BYOK API Keys (Groq, OpenRouter, Anthropic, etc.)

Add via Dashboard → **Connectors Hub** → BYOK API Keys section. Keys are stored encrypted (AES-256-GCM).

---

## Dashboard Pages

| Page | Route | Description |
|------|-------|-------------|
| Overview | `/` | Health, metrics, environment summary |
| Chat | `/chat` | Multi-provider chat, Plan/Code/Beast/Auto modes, STT |
| Tasks | `/tasks` | Projects, task queue, git worktree prepare, Review Gate |
| Workflows | `/workflows` | Multi-step shell/agent pipeline builder |
| Terminal | `/terminal` | NL-to-shell compiler, 3-tier risk badge |
| Connectors | `/accounts` | N-accounts, OAuth launch, BYOK keys, PAT integrations |
| Models | `/models` | Live model discovery |
| Usage | `/usage` | Daily heatmap, provider breakdown |
| Storage | `/storage` | Disk breakdown, cleanup, cloud backup |
| Settings | `/settings` | Theme, AGENTS.md editor |

---

## Updating

```bash
cd ~/azuron
git pull
sh install.sh   # rebuilds and re-links binary
```

---

## Uninstalling

```bash
# Remove global command
rm -f "$PREFIX/bin/azuron"          # Termux
rm -f "$HOME/.local/bin/azuron"     # Linux

# Optionally remove data (WARNING: deletes all chats and vault keys)
rm -rf ~/.azuron

# Optionally remove the repo
rm -rf ~/azuron
```

---

## Architecture

```
azuron/
├── packages/
│   ├── contract/     — Zod schemas, TypeScript types, shared constants
│   ├── server/       — Hono REST+SSE backend, all services, SQLite WAL
│   └── web/          — React 19 + Vite 6 + Tailwind dashboard SPA
├── bin/
│   └── azuron        — CLI entrypoint (start/stop/restart/status/doctor)
├── docs/
│   └── brand/        — AZURON logo assets
└── install.sh        — One-shot installer
```

**Key backend services:**

- `AzuronAccountVault` — AES-256-GCM encryption, isolated profile directories
- `AzuronChatManager` — JSONL-based chat storage, lazy loading, zero-copy attachments
- `AzuronStreamHub` — SSE event bus with SQLite persistence and Last-Event-ID replay
- `AzuronAiTerminal` — NL-to-shell compiler, 3-tier risk classification
- `AzuronTaskManager` — Project + task CRUD, git worktree lifecycle, Review Gate
- `AzuronWorkflowEngine` — Multi-step shell/agent pipelines with retry loops
- `AzuronStorageRetentionEngine` — Activity-based cleanup, pin/protect guard
- `AzuronCloudBackupService` — rclone push (full or per-project)

---

## Attribution

Contract patterns and native Codex/Antigravity runner abstractions adapted from [open-mercato/cezar](https://github.com/open-mercato/cezar) (MIT License, Copyright Patryk Lewczuk).

---

## License

MIT © ShaikhZaid404
