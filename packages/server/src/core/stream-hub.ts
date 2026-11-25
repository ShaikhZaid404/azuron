import type { DatabaseSync } from 'node:sqlite';
import type { StreamEvent, StreamEventType } from '@azuron/contract';

export interface ActiveRunSummary {
  id: string;
  kind: 'chat' | 'task' | 'terminal';
  title: string;
  step: string;
  startedAt: number;
}

type Subscriber = (event: StreamEvent) => void;

export class AzuronStreamHub {
  private readonly db: DatabaseSync;
  private readonly subscribers = new Set<Subscriber>();
  private readonly activeRuns = new Map<string, ActiveRunSummary>();

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public emit(
    channel: StreamEvent['channel'],
    entityId: string,
    type: StreamEventType,
    payload: Record<string, unknown>,
  ): StreamEvent {
    const timestamp = Date.now();
    const payloadJson = JSON.stringify(payload);
    const result = this.db
      .prepare(
        `INSERT INTO stream_events (channel, entity_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(channel, entityId, type, payloadJson, timestamp);

    const event: StreamEvent = {
      id: Number(result.lastInsertRowid),
      channel,
      entityId,
      type,
      payload,
      timestamp,
    };

    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // Isolate subscriber errors
      }
    }

    return event;
  }

  public replaySince(lastEventId: number, limit = 500): StreamEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, channel, entity_id, type, payload_json, created_at
         FROM stream_events
         WHERE id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(lastEventId, limit) as Array<{
      id: number;
      channel: StreamEvent['channel'];
      entity_id: string;
      type: StreamEventType;
      payload_json: string;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      entityId: row.entity_id,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      timestamp: row.created_at,
    }));
  }

  public subscribe(listener: Subscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  public setActiveRun(run: ActiveRunSummary): void {
    this.activeRuns.set(run.id, run);
  }

  public updateActiveRunStep(id: string, step: string): void {
    const current = this.activeRuns.get(id);
    if (current) {
      this.activeRuns.set(id, { ...current, step });
    }
  }

  public clearActiveRun(id: string): void {
    this.activeRuns.delete(id);
  }

  public getActiveRuns(): ActiveRunSummary[] {
    return Array.from(this.activeRuns.values());
  }

  public pruneOldEvents(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const res = this.db.prepare('DELETE FROM stream_events WHERE created_at < ?').run(cutoff);
    return Number(res.changes);
  }
}
