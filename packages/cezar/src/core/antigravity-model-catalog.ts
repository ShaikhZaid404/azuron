import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildChildEnv } from './agent-env.ts';
import { resolveAntigravityBin } from './antigravity-runner.ts';
import type { ModelOption } from './runner-model-catalog.ts';
import { spawnableCommand } from './windows-shim.ts';

export const DEFAULT_ANTIGRAVITY_MODELS: ModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Advanced reasoning, math, and deep code refactoring' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Ultra-fast, responsive multimodal coding' },
  { id: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro', description: 'Next-gen Google frontier reasoning model' },
  { id: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', description: 'Next-gen high-efficiency coding model' },
  { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', description: 'Hybrid Anthropic Sonnet via Antigravity' },
];

/** `agy models` prints a "Fetching…" banner, then one `<id>\t<label>` row per model (agy 1.4.0). */
export function parseAntigravityModelsOutput(output: string): ModelOption[] {
  const models = new Map<string, ModelOption>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([a-z0-9][a-z0-9._-]*-[a-z0-9._-]+)\s+(.+?)\s*$/.exec(line);
    if (match && models.size < 200) models.set(match[1]!, { id: match[1]!, label: match[2]!, description: '' });
  }
  return [...models.values()];
}

export async function discoverAntigravityModels(): Promise<ModelOption[]> {
  try {
    const { stdout } = await promisify(execFile)(...spawnableCommand(resolveAntigravityBin(), ['models']), {
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
      env: buildChildEnv({ backend: 'antigravity' }),
    });
    const models = parseAntigravityModelsOutput(stdout);
    if (models.length > 0) return models;
  } catch {
    // Fall back to default curated catalog
  }
  return DEFAULT_ANTIGRAVITY_MODELS;
}
