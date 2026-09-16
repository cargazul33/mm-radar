/** Minimal DB interface compatible with D1 PreparedStatement style and sql.js local adapter. */

export type SqlValue = string | number | null | bigint;

export type DbResult<T = Record<string, unknown>> = { results?: T[] };

export interface DbStatement {
  bind(...values: SqlValue[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run(): Promise<{ success: boolean; meta?: { changes?: number; last_row_id?: number | null } }>;
}

export interface Db {
  prepare(sql: string): DbStatement;
  exec?(sql: string): Promise<void>;
}

/** Alias used by newer MiniDb services (kept for compatibility). */
export type MiniDb = {
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  run(sql: string, ...params: SqlValue[]): Promise<{ lastId: number; changes: number }>;
  exec(sql: string): Promise<void>;
};

/** Wrap Cloudflare D1Database → prepare() API. */
export function wrapD1(d1: D1Database): Db {
  return {
    prepare(sql: string): DbStatement {
      let stmt = d1.prepare(sql);
      const api: DbStatement = {
        bind(...values: SqlValue[]) {
          stmt = d1.prepare(sql).bind(...values);
          return api;
        },
        async first<T>() {
          return (await stmt.first<T>()) ?? null;
        },
        async all<T>() {
          const res = await stmt.all<T>();
          return { results: (res.results || []) as T[] };
        },
        async run() {
          const res = await stmt.run();
          return {
            success: true,
            meta: {
              changes: res.meta?.changes,
              last_row_id: res.meta?.last_row_id ?? null,
            },
          };
        },
      };
      return api;
    },
    async exec(sql: string) {
      await d1.exec(sql);
    },
  };
}

/** Adapt prepare-Db → MiniDb for handlers/services. */
export function asMiniDb(db: Db): MiniDb {
  return {
    async all<T>(sql: string, ...params: SqlValue[]) {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(...params);
      const { results } = await stmt.all<T>();
      return results || [];
    },
    async one<T>(sql: string, ...params: SqlValue[]) {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(...params);
      return stmt.first<T>();
    },
    async run(sql: string, ...params: SqlValue[]) {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(...params);
      const res = await stmt.run();
      return {
        lastId: Number(res.meta?.last_row_id ?? 0),
        changes: Number(res.meta?.changes ?? 0),
      };
    },
    async exec(sql: string) {
      if (db.exec) await db.exec(sql);
      else await db.prepare(sql).run();
    },
  };
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Ensure migration 0002 columns exist (safe on fresh 0001 and old DBs). */
export async function ensureSchema(db: MiniDb): Promise<void> {
  const oppCols = await db.all<{ name: string }>("PRAGMA table_info(opportunities)");
  const oppNames = new Set(oppCols.map((c) => c.name));
  if (!oppNames.has("pliego_analysis_json")) {
    await db.exec(
      "ALTER TABLE opportunities ADD COLUMN pliego_analysis_json TEXT NOT NULL DEFAULT '{}'"
    );
  }
  const itemCols = await db.all<{ name: string }>("PRAGMA table_info(opportunity_items)");
  const itemNames = new Set(itemCols.map((c) => c.name));
  if (!itemNames.has("specs")) {
    await db.exec("ALTER TABLE opportunity_items ADD COLUMN specs TEXT NOT NULL DEFAULT ''");
  }
  if (!itemNames.has("mandatory_reqs")) {
    await db.exec(
      "ALTER TABLE opportunity_items ADD COLUMN mandatory_reqs TEXT NOT NULL DEFAULT ''"
    );
  }
}
