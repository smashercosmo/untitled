/** Executes our D1 SQL against Node's built-in SQLite with the real generated migrations. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Stmt } from "../src/writes";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

export function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) db.exec(sql);
    }
  }
  return db;
}

/** Runs statements in one transaction (like db.batch) and returns total changed rows. */
export function apply(db: DatabaseSync, stmts: Stmt[]): number {
  let changes = 0;
  db.exec("BEGIN");
  try {
    for (const s of stmts) changes += Number(db.prepare(s.sql).run(...s.params).changes);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return changes;
}

export function count(db: DatabaseSync, table: string, where = "1=1", ...params: (string | number)[]): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number };
  return Number(row.n);
}
