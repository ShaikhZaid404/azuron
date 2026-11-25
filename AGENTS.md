# AZURON — Project Guidelines & Architectural Rules

Before implementing or modifying any code in this repository, read:
1. [AZURON_MASTER_ARCHITECTURE_PLAN.md](./AZURON_MASTER_ARCHITECTURE_PLAN.md) — Complete 18-section technical specification.
2. [docs/CHAT_HISTORY.md](./docs/CHAT_HISTORY.md) — Complete exported planning transcript with full context and user decisions.

---

## Non-Negotiable Engineering & Design Rules

1. **Zero Emojis Rule:** Do NOT use emojis anywhere in the UI, terminal logs, CLI banners, badges, alerts, or code comments. Use clean monochrome Lucide SVG icons in the UI and crisp text tags (`[START]`, `[CHECK]`, `[TURN]`, `[ERROR]`) in terminal logs.
2. **Strict 70-20-8-2 Theme Distribution:**
   - **Dark Theme (Default):**
     - `70%` Background: `#0D0D0D`
     - `20%` Typography & Icons: `#FFFFFF` (100% solid white; never unreadable faded grey)
     - `8%` Buttons & Interactive Accents: `#7DBEFF`
     - `2%` Borders & Dividers: `#2B2B2B`
   - **Light Theme:**
     - `70%` Background: `#FFFFFF`
     - `20%` Typography & Icons: `#0D0D0D` (100% solid black)
     - `8%` Buttons & Interactive Accents: `#7DBEFF`
     - `2%` Borders & Dividers: `#E5E7EB` / subtle off-white
   - **Anti-AI-Slop Guardrail:** Strictly NO legacy purple accents, NO cyberpunk themes, NO neon glow blooms, and NO tacky gradients.
3. **100% AZURON Identity:** Completely replace all Cezar names, strings, routes, and icons with **AZURON** and the official geometric emblem at `docs/brand/azuron-logo.webp`. Retain MIT attribution notice cleanly where Cezar logic is referenced.
4. **Providers Scope:**
   - First-class native CLI integrations ONLY for **Google Antigravity (`agy`)** and **OpenAI Codex (`codex`)**.
   - **Gemini CLI (`gemini`) is completely removed.**
   - Unlimited N-accounts per provider with 1-click browser OAuth from the Web Dashboard and isolated profile directories.
   - Optional BYOK API keys (Groq, OpenRouter, etc.) managed on the same unified Connectors Hub.
5. **100% AZURON-Owned Chat Storage:** Never depend on provider internal caches/brain folders for conversation history. Store all global and project chats locally under AZURON's directory (`~/.azuron/chats/`) and index via embedded `node:sqlite` (WAL mode).
6. **Zero-Copy Attachments:** Never duplicate attached files or images into cache; reference original storage paths directly.
7. **Termux / Android Native Constraints:**
   - Use Node's built-in `node:sqlite` (zero native C++ build dependencies).
   - Never invoke `bwrap` (unsupported on Android kernel).
   - Invoke shared-storage scripts via explicit interpreters (`node`, `python`, `bash`) due to `noexec`.
   - Cap Node V8 heap via `--max-old-space-size=256`.
   - Default local loopback port: `45160` (avoid reserved `45157` / `45158`).
8. **Zero-Loss Live Streaming:** Keep SSE/WebSocket hub (`AzuronStreamHub`) mounted at root `<App />` level with `Last-Event-ID` SQLite catch-up so route switches never drop live chat/task streams.
9. **Test-Driven Rigor:** When writing or editing code, write verification tests, execute them, and state actual observed output before claiming completion.
