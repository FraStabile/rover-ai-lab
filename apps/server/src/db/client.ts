import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

export type Db = SqliteRemoteDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: DatabaseSync;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
}

/**
 * SQLite through Node's built-in `node:sqlite` (no native addon to compile),
 * exposed to Drizzle ORM via its sqlite-proxy driver.
 */
export function openDatabase(file: string): DbHandle {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  for (const m of schema.MIGRATIONS) sqlite.exec(m);

  const db = drizzle<typeof schema>(
    async (query, params, method) => {
      const stmt = sqlite.prepare(query);
      const args = params as SQLInputValue[];
      if (method === 'run') {
        stmt.run(...args);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === 'get') {
        const row = stmt.get(...args) as unknown as unknown[] | undefined;
        return { rows: row as unknown[] };
      }
      return { rows: stmt.all(...args) as unknown as unknown[][] };
    },
    { schema },
  );

  let depth = 0;
  return {
    db,
    sqlite,
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();
      depth++;
      sqlite.exec('BEGIN');
      try {
        const out = await fn();
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => sqlite.close(),
  };
}
