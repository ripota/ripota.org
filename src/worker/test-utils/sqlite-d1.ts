import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type D1Value = string | number | boolean | null;
type D1BindValue = D1Value | undefined;
type SqliteValue = string | number | bigint | Uint8Array | null;

type SqliteD1Context = {
  DB: D1Database;
  close(): void;
};

const migrations = [
  "0001_activate_ri_2026.sql",
  "0002_approval_operation_id.sql",
  "0003_magic_links_and_audit.sql",
  "0004_activators_and_plans.sql",
  "0005_stop_utc_instants.sql",
  "0006_activator_owned_stops.sql",
  "0007_activate_ri_edit_tokens.sql",
];

export function createMigratedSqliteD1(): SqliteD1Context {
  const directory = mkdtempSync(join(tmpdir(), "ripota-d1-"));
  const databasePath = join(directory, "test.sqlite");
  const sqlite = new DatabaseSync(databasePath);

  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migration of migrations) {
    sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }

  return {
    DB: new SqliteD1Database(sqlite) as unknown as D1Database,
    close() {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

class SqliteD1Database {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(this.sqlite, sql);
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        (statement as unknown as SqliteD1PreparedStatement).runSync<T>(),
      );
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqliteD1PreparedStatement {
  private values: D1BindValue[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: D1BindValue[]): this {
    this.values = values;
    return this;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.runSync<T>();
  }

  runSync<T = unknown>(): D1Result<T> {
    const statement = this.sqlite.prepare(this.sql);
    const result = statement.run(...this.sqliteValues());
    return {
      success: true,
      results: [],
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    } as unknown as D1Result<T>;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const statement = this.sqlite.prepare(this.sql);
    const results = statement.all(...this.sqliteValues()) as T[];
    return {
      success: true,
      results,
      meta: {
        changes: 0,
        last_row_id: 0,
      },
    } as unknown as D1Result<T>;
  }

  async first<T = unknown>(): Promise<T | null> {
    const statement = this.sqlite.prepare(this.sql);
    return (statement.get(...this.sqliteValues()) as T | undefined) ?? null;
  }

  private sqliteValues(): SqliteValue[] {
    return this.values.map((value) => {
      if (value === undefined || value === null) {
        return null;
      }

      return typeof value === "boolean" ? Number(value) : value;
    });
  }
}
