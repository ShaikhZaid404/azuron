import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RiskLevel, TerminalCommand } from '@azuron/contract';
import type { AzuronStreamHub } from '../core/stream-hub.js';

const DESTRUCTIVE_PATTERNS = [
  /(^|\s|;|&|\|)rm\s+/i,
  /(^|\s|;|&|\|)unlink\s+/i,
  /(^|\s|;|&|\|)shred\s+/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-[a-z]*f/i,
  /git\s+push\s+.*(--force|-f)\b/i,
  /(^|\s|;|&|\|)kill\s+-9/i,
  /(^|\s|;|&|\|)pkill\s+/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

const MODERATE_PATTERNS = [
  /\b(npm|pnpm|yarn|node|python|python3|bash|sh|pkg)\b/i,
  /git\s+(commit|checkout|switch|merge|rebase|pull|push|worktree)/i,
  /\b(mkdir|mv|cp|touch|chmod|chown)\b/i,
];

export function classifyCommandRisk(command: string): RiskLevel {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return 'destructive';
  }
  for (const pattern of MODERATE_PATTERNS) {
    if (pattern.test(command)) return 'moderate';
  }
  return 'safe';
}

export function enforceNoExecCompatibility(command: string): string {
  // Rewrite direct shared-storage script calls to explicit interpreters
  return command.replace(
    /(^|\s)(\.\/[^\s]+\.(sh|py|js|mjs))\b/g,
    (_full, prefix: string, script: string, ext: string) => {
      const interp = ext === 'py' ? 'python' : ext === 'sh' ? 'bash' : 'node';
      return `${prefix}${interp} ${script}`;
    },
  );
}

export function compileNaturalLanguageToShell(userPrompt: string): {
  compiledCommand: string;
  explanation: string;
} {
  const lower = userPrompt.toLowerCase();
  if (/git\s*status|status.*git/.test(lower)) {
    return {
      compiledCommand: 'git status -sb',
      explanation: 'Displays short git working tree status and active branch.',
    };
  }
  if (/git\s*log|commits?/.test(lower)) {
    return {
      compiledCommand: 'git log -n 10 --oneline',
      explanation: 'Lists the 10 most recent commits in compact format.',
    };
  }
  if (/git\s*diff|changes/.test(lower)) {
    return {
      compiledCommand: 'git diff --stat',
      explanation: 'Summarizes unstaged file changes in the project repository.',
    };
  }
  if (/list\s*files|files\s*list|directory/.test(lower)) {
    return {
      compiledCommand: 'ls -la',
      explanation: 'Lists all files and directories including hidden dotfiles.',
    };
  }
  if (/run\s*tests?|test\s*run/.test(lower)) {
    return {
      compiledCommand: 'npm test',
      explanation: 'Runs the project test suite configured in package.json.',
    };
  }
  if (/build\s*project|project\s*build/.test(lower)) {
    return {
      compiledCommand: 'npm run build',
      explanation: 'Executes the project build script.',
    };
  }
  if (/disk|storage|space/.test(lower)) {
    return {
      compiledCommand: 'df -h .',
      explanation: 'Checks available filesystem space for the current project.',
    };
  }

  // Pass through explicit shell commands when user enters them directly
  const cleaned = enforceNoExecCompatibility(userPrompt.trim());
  return {
    compiledCommand: cleaned,
    explanation: 'Executes the requested shell command in the project working directory.',
  };
}

export class AzuronAiTerminal {
  private readonly db: DatabaseSync;
  private readonly hub: AzuronStreamHub;

  constructor(db: DatabaseSync, hub: AzuronStreamHub) {
    this.db = db;
    this.hub = hub;
  }

  public listCommands(projectId?: string, limit = 50): TerminalCommand[] {
    const rows = (
      projectId
        ? this.db
            .prepare('SELECT * FROM terminal_commands WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(projectId, limit)
        : this.db
            .prepare('SELECT * FROM terminal_commands ORDER BY created_at DESC LIMIT ?')
            .all(limit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapCommand(r));
  }

  public compile(projectId: string, userPrompt: string): TerminalCommand {
    const id = `cmd_${crypto.randomUUID().slice(0, 10)}`;
    const { compiledCommand, explanation } = compileNaturalLanguageToShell(userPrompt);
    const safeCmd = enforceNoExecCompatibility(compiledCommand);
    const riskLevel = classifyCommandRisk(safeCmd);
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO terminal_commands (id, project_id, user_prompt, compiled_command, explanation, risk_level, approval_status, exit_code, output_log, executed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?)`,
      )
      .run(id, projectId, userPrompt, safeCmd, explanation, riskLevel, now);

    return this.getCommand(id)!;
  }

  public getCommand(id: string): TerminalCommand | null {
    const row = this.db.prepare('SELECT * FROM terminal_commands WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapCommand(row) : null;
  }

  public async decideAndExecute(
    id: string,
    decision: 'approved' | 'rejected',
    confirmationText?: string,
  ): Promise<TerminalCommand> {
    const cmd = this.getCommand(id);
    if (!cmd) {
      throw new Error(`Terminal command not found: ${id}`);
    }
    if (cmd.approvalStatus !== 'pending') {
      throw new Error(`Command ${id} already decided (${cmd.approvalStatus})`);
    }

    if (decision === 'rejected') {
      this.db
        .prepare("UPDATE terminal_commands SET approval_status = 'rejected' WHERE id = ?")
        .run(id);
      return this.getCommand(id)!;
    }

    if (cmd.riskLevel === 'destructive' && confirmationText?.trim().toUpperCase() !== 'CONFIRM') {
      throw new Error('Destructive command requires confirmationText="CONFIRM".');
    }

    const project = this.db
      .prepare('SELECT filesystem_path FROM projects WHERE id = ?')
      .get(cmd.projectId) as { filesystem_path: string } | undefined;
    const cwd = project?.filesystem_path || process.cwd();

    this.db
      .prepare("UPDATE terminal_commands SET approval_status = 'approved' WHERE id = ?")
      .run(id);

    const shellBin = process.env.SHELL || '/bin/sh';
    const executedAt = Date.now();
    let outputLog = '';

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(shellBin, ['-c', cmd.compiledCommand], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const onData = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        outputLog += text;
        this.hub.emit('terminal', id, 'terminal.output', { text });
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => {
        outputLog += `${err.message}\n`;
        resolve(1);
      });
      child.on('close', (code) => {
        resolve(code ?? 1);
      });
    });

    this.db
      .prepare(
        'UPDATE terminal_commands SET exit_code = ?, output_log = ?, executed_at = ? WHERE id = ?',
      )
      .run(exitCode, outputLog, executedAt, id);

    this.hub.emit('terminal', id, 'terminal.exit', { exitCode });
    return this.getCommand(id)!;
  }

  private mapCommand(row: Record<string, unknown>): TerminalCommand {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      userPrompt: String(row.user_prompt),
      compiledCommand: String(row.compiled_command),
      explanation: String(row.explanation),
      riskLevel: String(row.risk_level) as RiskLevel,
      approvalStatus: String(row.approval_status) as TerminalCommand['approvalStatus'],
      exitCode: row.exit_code !== null && row.exit_code !== undefined ? Number(row.exit_code) : null,
      outputLog: row.output_log ? String(row.output_log) : null,
      executedAt: row.executed_at !== null && row.executed_at !== undefined ? Number(row.executed_at) : null,
      createdAt: Number(row.created_at),
    };
  }
}
