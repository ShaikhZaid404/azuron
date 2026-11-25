import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

export type LogTag = 'START' | 'CHECK' | 'TURN' | 'INFO' | 'WARN' | 'ERROR';

export class AzuronLogger {
  private readonly logFilePath: string | null;

  constructor(logFilePath?: string | null) {
    this.logFilePath = logFilePath ?? null;
    if (this.logFilePath) {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
    }
  }

  public log(tag: LogTag, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const metaSuffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const plainLine = `${timestamp} [${tag}] ${message}${metaSuffix}`;

    if (this.logFilePath) {
      this.appendRotating(plainLine);
    }

    const coloredTag = this.formatTag(tag);
    const line = `${chalk.dim(timestamp)} ${coloredTag} ${message}${metaSuffix ? chalk.dim(metaSuffix) : ''}`;
    if (tag === 'ERROR') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  public banner(lines: string[]): void {
    const width = Math.max(...lines.map((l) => l.length), 48) + 4;
    const border = '+' + '-'.repeat(width) + '+';
    console.log(chalk.hex('#7DBEFF')(border));
    for (const content of lines) {
      const padded = content.padEnd(width - 2, ' ');
      console.log(`${chalk.hex('#7DBEFF')('|')} ${chalk.white(padded)} ${chalk.hex('#7DBEFF')('|')}`);
    }
    console.log(chalk.hex('#7DBEFF')(border));
  }

  private formatTag(tag: LogTag): string {
    switch (tag) {
      case 'START':
        return chalk.hex('#7DBEFF').bold('[START]');
      case 'CHECK':
        return chalk.green.bold('[CHECK]');
      case 'TURN':
        return chalk.cyan.bold('[TURN]');
      case 'WARN':
        return chalk.yellow.bold('[WARN]');
      case 'ERROR':
        return chalk.red.bold('[ERROR]');
      case 'INFO':
      default:
        return chalk.white.bold('[INFO]');
    }
  }

  private appendRotating(line: string): void {
    if (!this.logFilePath) return;
    try {
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        // Rotate at 5 MB to protect Android flash storage
        if (stats.size > 5 * 1024 * 1024) {
          const rotated = `${this.logFilePath}.1`;
          if (fs.existsSync(rotated)) {
            fs.unlinkSync(rotated);
          }
          fs.renameSync(this.logFilePath, rotated);
        }
      }
      fs.appendFileSync(this.logFilePath, `${line}\n`, 'utf8');
    } catch {
      // Never crash daemon if log rotation fails
    }
  }
}
