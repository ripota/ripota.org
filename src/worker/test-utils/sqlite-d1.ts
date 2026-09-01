import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type D1Value = string | number | boolean | null;
type D1BindValue = D1Value | undefined;
type SqliteValue = string | number | bigint | Uint8Array | null;

type SqliteD1Context = {
  DB: D1Database;
  applyMigrationFile(name: string): void;
  close(): void;
};

const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export function discoverMigrationFiles(
  directory = resolve("migrations"),
): string[] {
  return readdirSync(directory)
    .filter((name) => migrationNamePattern.test(name))
    .sort((left, right) => left.localeCompare(right));
}

export function createMigratedSqliteD1(options: { through?: string } = {}): SqliteD1Context {
  const directory = mkdtempSync(join(tmpdir(), "ripota-d1-"));
  const databasePath = join(directory, "test.sqlite");
  const sqlite = new DatabaseSync(databasePath);

  sqlite.exec("PRAGMA foreign_keys = ON;");
  const migrations = discoverMigrationFiles();
  const selected = options.through
    ? migrations.slice(0, migrations.indexOf(options.through) + 1)
    : migrations;
  if (options.through && !selected.includes(options.through)) {
    throw new Error(`Unknown migration: ${options.through}`);
  }
  for (const migration of selected) {
    sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
  }

  return {
    DB: new SqliteD1Database(sqlite) as unknown as D1Database,
    applyMigrationFile(name: string) {
      if (!migrations.includes(name)) throw new Error(`Unknown migration: ${name}`);
      sqlite.exec(readFileSync(resolve("migrations", name), "utf8"));
    },
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
    if (/^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(this.sql)) {
      const results = statement.all(...this.sqliteValues()) as T[];
      return {
        success: true,
        results,
        meta: { changes: 0, last_row_id: 0 },
      } as unknown as D1Result<T>;
    }
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
