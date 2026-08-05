import sqlite3 from 'sqlite3'
import type {
  HistoryDateSummary,
  HistoryHealth,
  HistoryOutcome,
  HistoryRangeResult,
  HistoryResponse,
  HistoryResult,
  HistoryRunStatus,
  WeeklyHistorySummary,
} from '../../src/types/history'
import type { WorkflowMode } from '../../src/types/eolRunner'
import {
  currentLocalWeek,
  localRangeBounds,
  type ValidatedHistoryRange,
} from './historyValidation.ts'

const SCHEMA_VERSION = 2
const SAFE_DATABASE_ERROR = 'Local history is unavailable.'

interface RunResult {
  lastID: number
  changes: number
}

interface CountRow {
  total: number
  completed: number
  needs_review: number
  mri: number
  mri_fail: number
  eol: number
}

interface ResultRow {
  id: number
  asset_id: string
  mode: WorkflowMode
  outcome: HistoryOutcome
  reason: string | null
  started_at: string
  finished_at: string
}

export class LocalHistoryStore {
  private readonly databasePath: string
  private database: sqlite3.Database | null = null
  private health: HistoryHealth = { available: false, message: SAFE_DATABASE_ERROR }
  private readonly listeners = new Set<() => void>()

  constructor(databasePath: string) {
    this.databasePath = databasePath
  }

  async initialize(): Promise<void> {
    try {
      this.database = await openDatabase(this.databasePath)
      await exec(this.requireDatabase(), 'PRAGMA foreign_keys = ON')
      await exec(this.requireDatabase(), 'PRAGMA journal_mode = WAL')
      await this.migrate()
      this.health = { available: true, message: null }
    } catch {
      await this.close().catch(() => undefined)
      this.markUnavailable()
    }
  }

  getHealth(): HistoryHealth {
    return { ...this.health }
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async createRun(
    mode: WorkflowMode,
    startedAt: string,
    runnerLabel: string | null = null,
  ): Promise<number | null> {
    return this.write(async (database) => {
      const result = await run(
        database,
        `INSERT INTO runs (mode, status, started_at, finished_at, runner_label)
         VALUES (?, 'running', ?, NULL, ?)`,
        [mode, startedAt, runnerLabel],
      )
      return result.lastID
    }, null)
  }

  async finalizeRun(
    runId: number,
    status: Exclude<HistoryRunStatus, 'running'>,
    finishedAt: string,
  ): Promise<boolean> {
    return this.write(async (database) => {
      const result = await run(
        database,
        `UPDATE runs
         SET status = ?, finished_at = ?
         WHERE id = ? AND status = 'running'`,
        [status, finishedAt, runId],
      )
      return result.changes > 0
    }, false)
  }

  async recordAssetResult(input: {
    runId: number
    assetId: string
    mode: WorkflowMode
    outcome: HistoryOutcome
    reason: string | null
    startedAt: string
    finishedAt: string
  }): Promise<boolean> {
    const saved = await this.write(async (database) => {
      const result = await run(
        database,
        `INSERT INTO asset_results
          (run_id, asset_id, mode, outcome, reason, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, asset_id) DO NOTHING`,
        [
          input.runId,
          input.assetId,
          input.mode,
          input.outcome,
          input.reason,
          input.startedAt,
          input.finishedAt,
        ],
      )
      return result.changes > 0
    }, false)
    if (saved) this.emitChanged()
    return saved
  }

  async getWeeklySummary(now = new Date()): Promise<HistoryResponse<WeeklyHistorySummary>> {
    const week = currentLocalWeek(now)
    return this.read(async (database) => {
      const counts = await queryCounts(database, week.start, week.end, '', null, null)
      return {
        weekStart: week.startDate,
        weekEnd: week.endDate,
        total: counts.total,
        completed: counts.completed,
        needsReview: counts.needs_review,
        byMode: { MRI: counts.mri, MRI_FAIL: counts.mri_fail, EOL: counts.eol },
      }
    })
  }

  async getHistoryDates(limit = 366): Promise<HistoryResponse<HistoryDateSummary[]>> {
    return this.read(async (database) => {
      return all<HistoryDateSummary>(
        database,
        `SELECT date(finished_at, 'localtime') AS date, COUNT(*) AS total
         FROM asset_results
         GROUP BY date(finished_at, 'localtime')
         ORDER BY date DESC
         LIMIT ?`,
        [limit],
      )
    })
  }

  async getHistoryRange(request: ValidatedHistoryRange): Promise<HistoryResponse<HistoryRangeResult>> {
    const bounds = localRangeBounds(request.startDate, request.endDate)
    return this.read(async (database) => {
      const where = buildResultWhere(bounds.start, bounds.end, request)
      const counts = await queryCounts(
        database,
        bounds.start,
        bounds.end,
        request.search,
        request.mode,
        request.outcome,
      )
      const rows = await all<ResultRow>(
        database,
        `SELECT id, asset_id, mode, outcome, reason, started_at, finished_at
         FROM asset_results
         ${where.sql}
         ORDER BY finished_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...where.params, request.limit, request.offset],
      )
      return {
        startDate: request.startDate,
        endDate: request.endDate,
        total: counts.total,
        completed: counts.completed,
        needsReview: counts.needs_review,
        byMode: { MRI: counts.mri, MRI_FAIL: counts.mri_fail, EOL: counts.eol },
        results: rows.map(mapResultRow),
        limit: request.limit,
        offset: request.offset,
      }
    })
  }

  async close(): Promise<void> {
    const database = this.database
    this.database = null
    if (database === null) return
    await new Promise<void>((resolve, reject) => {
      database.close((error) => error === null ? resolve() : reject(error))
    })
  }

  private async migrate(): Promise<void> {
    const database = this.requireDatabase()
    const version = await get<{ user_version: number }>(database, 'PRAGMA user_version')
    const currentVersion = version?.user_version ?? 0
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error('History database schema is newer than this application.')
    }
    if (currentVersion === SCHEMA_VERSION) return
    await exec(database, 'BEGIN IMMEDIATE')
    try {
      if (currentVersion < 1) {
        await exec(database, `
          CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mode TEXT NOT NULL CHECK (mode IN ('EOL', 'MRI', 'MRI_FAIL', 'REPAIR')),
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'stopped', 'disconnected', 'error')),
            started_at TEXT NOT NULL,
            finished_at TEXT
          );
          CREATE TABLE IF NOT EXISTS asset_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            asset_id TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('EOL', 'MRI', 'MRI_FAIL', 'REPAIR')),
            outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'needs_review')),
            reason TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL,
            UNIQUE (run_id, asset_id)
          );
          CREATE INDEX IF NOT EXISTS idx_asset_results_finished_at ON asset_results(finished_at);
          CREATE INDEX IF NOT EXISTS idx_asset_results_mode ON asset_results(mode);
          CREATE INDEX IF NOT EXISTS idx_asset_results_outcome ON asset_results(outcome);
        `)
      }
      if (currentVersion < 2) {
        await exec(database, 'ALTER TABLE runs ADD COLUMN runner_label TEXT')
      }
      await exec(database, 'PRAGMA user_version = 2')
      await exec(database, 'COMMIT')
    } catch (error: unknown) {
      await exec(database, 'ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  private async write<T>(operation: (database: sqlite3.Database) => Promise<T>, fallback: T): Promise<T> {
    if (!this.health.available || this.database === null) return fallback
    try {
      return await operation(this.database)
    } catch {
      this.markUnavailable()
      return fallback
    }
  }

  private async read<T>(operation: (database: sqlite3.Database) => Promise<T>): Promise<HistoryResponse<T>> {
    if (!this.health.available || this.database === null) return unavailableResponse(this.health)
    try {
      return { ok: true, data: await operation(this.database), health: this.getHealth() }
    } catch {
      this.markUnavailable()
      return unavailableResponse(this.health)
    }
  }

  private requireDatabase(): sqlite3.Database {
    if (this.database === null) throw new Error('History database is not initialized.')
    return this.database
  }

  private markUnavailable(): void {
    const changed = this.health.available
    this.health = { available: false, message: SAFE_DATABASE_ERROR }
    if (changed) this.emitChanged()
  }

  private emitChanged(): void {
    for (const listener of this.listeners) listener()
  }
}

async function queryCounts(
  database: sqlite3.Database,
  start: string,
  end: string,
  search: string,
  mode: WorkflowMode | null,
  outcome: HistoryOutcome | null,
): Promise<CountRow> {
  const where = buildResultWhere(start, end, { search, mode, outcome })
  return (await get<CountRow>(
    database,
    `SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN outcome = 'needs_review' THEN 1 ELSE 0 END), 0) AS needs_review,
      COALESCE(SUM(CASE WHEN mode = 'MRI' THEN 1 ELSE 0 END), 0) AS mri,
      COALESCE(SUM(CASE WHEN mode = 'MRI_FAIL' THEN 1 ELSE 0 END), 0) AS mri_fail,
      COALESCE(SUM(CASE WHEN mode = 'EOL' THEN 1 ELSE 0 END), 0) AS eol
     FROM asset_results ${where.sql}`,
    where.params,
  )) ?? { total: 0, completed: 0, needs_review: 0, mri: 0, mri_fail: 0, eol: 0 }
}

function buildResultWhere(
  start: string,
  end: string,
  filters: { search: string; mode: WorkflowMode | null; outcome: HistoryOutcome | null },
): { sql: string; params: unknown[] } {
  const clauses = ['finished_at >= ?', 'finished_at < ?']
  const params: unknown[] = [start, end]
  if (filters.search !== '') {
    clauses.push("UPPER(asset_id) LIKE ? ESCAPE '\\'")
    params.push(`%${escapeLike(filters.search)}%`)
  }
  if (filters.mode !== null) {
    clauses.push('mode = ?')
    params.push(filters.mode)
  }
  if (filters.outcome !== null) {
    clauses.push('outcome = ?')
    params.push(filters.outcome)
  }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function mapResultRow(row: ResultRow): HistoryResult {
  return {
    id: row.id,
    assetId: row.asset_id,
    mode: row.mode,
    outcome: row.outcome,
    reason: row.reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

function unavailableResponse<T>(health: HistoryHealth): HistoryResponse<T> {
  return { ok: false, data: null, health: { ...health }, error: SAFE_DATABASE_ERROR }
}

function openDatabase(path: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(path, (error) => {
      if (error === null) resolve(database)
      else reject(error)
    })
  })
}

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => error === null ? resolve() : reject(error))
  })
}

function run(database: sqlite3.Database, sql: string, params: unknown[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error !== null) reject(error)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

function get<T>(database: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row: T | undefined) => error === null ? resolve(row) : reject(error))
  })
}

function all<T>(database: sqlite3.Database, sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows: T[]) => error === null ? resolve(rows) : reject(error))
  })
}
