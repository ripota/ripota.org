# Activate RI Real DB and Browser E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one fast real-SQL API acceptance test and one slow opt-in browser E2E test for the Activate All RI 2026 volunteer submission flow.

**Architecture:** Keep normal unit tests fast, but add a small `node:sqlite` D1 test adapter that applies the real migrations into a temporary SQLite file. Add a separate Playwright-based smoke test task that starts the local Worker, drives the real volunteer form in a browser, approves the submission, and verifies the approved activation is visible publicly.

**Tech Stack:** Vitest, Node `node:sqlite`, Cloudflare Worker route handlers, Wrangler local dev, Playwright, mise file-based tasks.

---

## File Structure

- Create `src/worker/test-utils/sqlite-d1.ts`: minimal D1 adapter over `node:sqlite`, migration loader, temporary DB lifecycle helpers.
- Create `src/worker/activate-ri.acceptance.test.ts`: fast API acceptance test using the real route handler and real SQLite-backed D1.
- Create `e2e/activate-ri-volunteer.spec.ts`: slow browser smoke test using Playwright.
- Create `e2e/helpers/activate-ri-server.ts`: starts/stops local Wrangler dev for E2E tests and chooses an available port.
- Create `mise/tasks/e2e/activate-ri`: opt-in task that runs only the slow browser smoke test.
- Modify `package.json` and `package-lock.json`: add `@playwright/test` dev dependency and an `e2e:activate-ri` npm script.
- Modify `wrangler.jsonc`: add local-only vars needed for browser E2E admin access, if not already available.
- Modify `src/worker/env.ts`: include existing local admin auth vars used by `src/worker/access.ts`.

## Task 1: Add A Real SQLite D1 Test Adapter

**Files:**
- Create: `src/worker/test-utils/sqlite-d1.ts`
- Test indirectly in: `src/worker/activate-ri.acceptance.test.ts`

- [ ] **Step 1: Create the test utility file**

Create `src/worker/test-utils/sqlite-d1.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync, type SupportedValueType } from "node:sqlite";

type D1Value = string | number | boolean | null;
type D1BindValue = D1Value | undefined;

type SqliteD1Context = {
  DB: D1Database;
  close(): void;
};

export function createMigratedSqliteD1(): SqliteD1Context {
  const directory = mkdtempSync(join(tmpdir(), "ripota-d1-"));
  const databasePath = join(directory, "test.sqlite");
  const sqlite = new DatabaseSync(databasePath);

  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migration of [
    "0001_activate_ri_2026.sql",
    "0002_approval_operation_id.sql",
    "0003_magic_links_and_audit.sql",
    "0004_activators_and_plans.sql",
    "0005_stop_utc_instants.sql",
  ]) {
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

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const run = this.sqlite.transaction((input: D1PreparedStatement[]) =>
      input.map((statement) =>
        (statement as unknown as SqliteD1PreparedStatement).runSync<T>(),
      ),
    );
    return run(statements);
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
    } as D1Result<T>;
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
    } as D1Result<T>;
  }

  async first<T = unknown>(): Promise<T | null> {
    const statement = this.sqlite.prepare(this.sql);
    return (statement.get(...this.sqliteValues()) as T | undefined) ?? null;
  }

  private sqliteValues(): SupportedValueType[] {
    return this.values.map((value) => value ?? null) as SupportedValueType[];
  }
}
```

- [ ] **Step 2: Do not run tests yet**

This file is infrastructure. The red test comes in Task 2.

## Task 2: Add Fast API Acceptance Test

**Files:**
- Create: `src/worker/activate-ri.acceptance.test.ts`
- Use: `src/worker/test-utils/sqlite-d1.ts`

- [ ] **Step 1: Write the failing acceptance test**

Create `src/worker/activate-ri.acceptance.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { handleActivateRiApi } from "./routes/activate-ri";
import type { Env } from "./env";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const adminEmail = "organizer@example.com";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("Activate RI API acceptance flow", () => {
  it("saves a volunteer plan, lists it for admins, approves it, and publishes it publicly", async () => {
    const db = createMigratedSqliteD1();
    cleanup = db.close;
    const env = testEnv(db.DB);

    const submitResponse = await handleActivateRiApi(
      jsonRequest("/api/activate-ri-2026/plans", volunteerPayload()),
      env,
    );
    expect(submitResponse.status).toBe(202);
    await expect(submitResponse.json()).resolves.toMatchObject({
      ok: true,
      message: "Submission received for organizer review.",
    });

    const pendingResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env,
    );
    expect(pendingResponse.status).toBe(200);
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{ id: string; status: string; stops: Array<{ status: string }> }>;
    };
    expect(pendingBody.plans).toHaveLength(1);
    expect(pendingBody.plans[0]).toMatchObject({
      status: "pending",
      stops: [{ status: "pending-review" }],
    });

    const planId = pendingBody.plans[0].id;
    const approveResponse = await handleActivateRiApi(
      adminRequest(`/api/activate-ri-2026/admin/plans/${planId}/approve`, {
        method: "POST",
      }),
      env,
    );
    expect(approveResponse.status).toBe(200);
    await expect(approveResponse.json()).resolves.toEqual({ ok: true });

    const publicResponse = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/public/stops"),
      env,
    );
    expect(publicResponse.status).toBe(200);
    const publicBody = (await publicResponse.json()) as {
      stops: Array<{
        parkReference: string;
        activatorCallsign: string;
        plannedDate: string;
        startTime: string;
        endTime: string;
        bands: string[];
        modes: string[];
        status: string;
      }>;
    };
    expect(publicBody.stops).toEqual([
      expect.objectContaining({
        parkReference: "US-2868",
        activatorCallsign: "N1RWJ",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["SSB"],
        status: "scheduled",
      }),
    ]);
  });
});

function testEnv(DB: D1Database): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    ASSETS: { fetch: async () => new Response("not used") } as Fetcher,
    DB,
    EMAIL: {
      send: async () => ({ messageId: "test-message" }),
    } as unknown as SendEmail,
  };
}

function volunteerPayload(): Record<string, unknown> {
  return {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    club: "RI POTA",
    organizerNotes: "Acceptance test submission.",
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        timeBlock: "09:00-12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "Acceptance test public note.",
      },
    ],
  };
}

function jsonRequest(path: string, payload: unknown): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function adminRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ripota.org${path}`, {
    ...init,
    headers: {
      "Cf-Access-Authenticated-User-Email": adminEmail,
      ...init.headers,
    },
  });
}
```

- [ ] **Step 2: Run test to verify it fails before implementation is complete**

Run:

```bash
rtk npm test -- --run src/worker/activate-ri.acceptance.test.ts --reporter=dot
```

Expected before Task 1 is correct: failure or runtime error in the SQLite adapter. If it passes immediately after Task 1, intentionally revert the stop insert fix in `src/worker/db.ts`, rerun this test, and confirm it fails with a SQLite values/columns error. Restore the fix after verifying red.

- [ ] **Step 3: Make minimal adapter fixes until the test passes**

Keep changes constrained to `src/worker/test-utils/sqlite-d1.ts`. Do not alter production DB code except to restore the known placeholder fix if it was temporarily reverted for red verification.

- [ ] **Step 4: Run focused acceptance test**

Run:

```bash
rtk npm test -- --run src/worker/activate-ri.acceptance.test.ts --reporter=dot
```

Expected: 1 test file passed, 1 test passed.

- [ ] **Step 5: Run all fast tests**

Run:

```bash
rtk npm test -- --run --reporter=dot
```

Expected: all Vitest tests pass.

## Task 3: Add Local Admin Auth Types And E2E-Friendly Local Vars

**Files:**
- Modify: `src/worker/env.ts`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Write the failing type expectation**

Add this test to `src/worker/index.test.ts` or create a small `src/worker/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Env } from "./env";

describe("worker env typing", () => {
  it("allows local admin auth variables used by Access fallback", () => {
    const env = {
      ASSETS: { fetch: async () => new Response("ok") } as Fetcher,
      DB: {} as D1Database,
      ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
      ALLOW_LOCAL_ADMIN_AUTH: "true",
      LOCAL_ADMIN_EMAIL: "local-admin@example.com",
    } satisfies Env;

    expect(env.ALLOW_LOCAL_ADMIN_AUTH).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk npm test -- --run src/worker/env.test.ts --reporter=dot
```

Expected: TypeScript/Vitest transform fails because `ALLOW_LOCAL_ADMIN_AUTH` and `LOCAL_ADMIN_EMAIL` are not part of `Env`.

- [ ] **Step 3: Update `Env`**

Modify `src/worker/env.ts`:

```ts
export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  EMAIL?: SendEmail;
  ACTIVATE_RI_EVENT_ID: "activate-ri-2026";
  TURNSTILE_REQUIRED?: "true" | "false";
  TURNSTILE_SECRET_KEY?: string;
  ACTIVATE_RI_EMAIL_FROM?: string;
  ACTIVATE_RI_EMAIL_FROM_NAME?: string;
  ACTIVATE_RI_ADMIN_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOW_ADMIN_HEADER_AUTH?: "true" | "false";
  ALLOW_LOCAL_ADMIN_AUTH?: "true" | "false";
  LOCAL_ADMIN_EMAIL?: string;
};
```

- [ ] **Step 4: Add local-only Wrangler vars**

In `wrangler.jsonc`, under `env.local.vars`, add:

```jsonc
"ALLOW_LOCAL_ADMIN_AUTH": "true",
"LOCAL_ADMIN_EMAIL": "local-admin@ripota.org"
```

Keep these inside `env.local.vars`; do not add them to top-level production vars.

- [ ] **Step 5: Run focused env test**

Run:

```bash
rtk npm test -- --run src/worker/env.test.ts --reporter=dot
```

Expected: test passes.

## Task 4: Add Playwright Browser Smoke Test Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `e2e/helpers/activate-ri-server.ts`
- Create: `mise/tasks/e2e/activate-ri`

- [ ] **Step 1: Add Playwright dependency**

Run:

```bash
rtk npm install --save-dev @playwright/test
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Add npm script**

Modify `package.json` scripts:

```json
"e2e:activate-ri": "playwright test e2e/activate-ri-volunteer.spec.ts"
```

- [ ] **Step 3: Create the local server helper**

Create `e2e/helpers/activate-ri-server.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

export type ActivateRiServer = {
  origin: string;
  stop(): Promise<void>;
};

export async function startActivateRiServer(): Promise<ActivateRiServer> {
  const port = await freePort();
  const child = spawn(
    "./node_modules/.bin/wrangler",
    ["dev", "--env", "local", "--port", String(port), "--local"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const origin = `http://127.0.0.1:${port}`;
  await waitForServerReady(child, origin);

  return {
    origin,
    async stop() {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    },
  };
}

async function waitForServerReady(
  child: ChildProcessWithoutNullStreams,
  origin: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let logs = "";

  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited early:\n${logs}`);
    }

    try {
      const response = await fetch(`${origin}/api/activate-ri-2026/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for wrangler dev:\n${logs}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  await once(server, "close");

  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local port.");
  }

  return address.port;
}
```

- [ ] **Step 4: Add mise task**

Create `mise/tasks/e2e/activate-ri`:

```bash
#!/usr/bin/env bash
# -*- mode: sh; sh-shell: bash; -*-
#MISE description="Run slow Activate RI browser E2E smoke test"
#MISE raw=true

set -euo pipefail

npm run e2e:activate-ri -- "$@"
```

- [ ] **Step 5: Make task executable**

Run:

```bash
rtk chmod +x mise/tasks/e2e/activate-ri
```

## Task 5: Add Slow Browser E2E Smoke Test

**Files:**
- Create: `e2e/activate-ri-volunteer.spec.ts`

- [ ] **Step 1: Write the browser test**

Create `e2e/activate-ri-volunteer.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("volunteer can submit a plan that can be approved and shown publicly", async ({ page, request }) => {
  const server = await startActivateRiServer();
  try {
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);

    await page.getByLabel(/Callsign/).first().fill("N1RWJ");
    await page.getByLabel(/Name/).first().fill("Rob Jackson");
    await page.getByLabel(/Email/).first().fill("rob@example.com");
    await page.getByLabel("Club / group affiliation").fill("RI POTA");
    await page.getByLabel("Park").fill("US-2868");
    await page.locator("[data-time-block]").selectOption("09:00-12:00");

    await page.getByRole("button", { name: "Choose bands" }).click();
    await page.getByLabel("40m").check();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Choose modes" }).click();
    await page.getByLabel("SSB").check();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("Submission received for organizer review.")).toBeVisible();

    const pendingResponse = await request.get(`${server.origin}/api/activate-ri-2026/admin/plans`, {
      headers: {
        "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org",
      },
    });
    expect(pendingResponse.ok()).toBe(true);
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{ id: string; submitter_callsign: string }>;
    };
    expect(pendingBody.plans).toHaveLength(1);
    expect(pendingBody.plans[0].submitter_callsign).toBe("N1RWJ");

    const approveResponse = await request.post(
      `${server.origin}/api/activate-ri-2026/admin/plans/${pendingBody.plans[0].id}/approve`,
      {
        headers: {
          "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org",
        },
      },
    );
    expect(approveResponse.ok()).toBe(true);

    await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
    await expect(page.getByText("N1RWJ")).toBeVisible();
    await expect(page.getByText("US-2868")).toBeVisible();
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 2: Run test to verify it fails before local E2E environment is correct**

Run:

```bash
rtk mise run e2e:activate-ri
```

Expected before all infra is correct: failure starting Wrangler, finding selectors, or reading public schedule data. Use the failure to adjust selectors or local env only.

- [ ] **Step 3: Fix selectors and local dev setup only**

Keep fixes constrained to:

- `e2e/activate-ri-volunteer.spec.ts`
- `e2e/helpers/activate-ri-server.ts`
- `wrangler.jsonc`
- `src/worker/env.ts`

Do not loosen production validation to satisfy the test.

- [ ] **Step 4: Run slow E2E**

Run:

```bash
rtk mise run e2e:activate-ri
```

Expected: Playwright reports one passing test.

## Task 6: Document How And When To Run These Tests

**Files:**
- Modify: `README.md`
- Modify: `docs/activate-ri-2026/data-flow.md`

- [ ] **Step 1: Update README testing section**

Add:

```md
### Activate RI acceptance tests

The normal Vitest suite includes a real-SQL API acceptance test for the Activate
RI volunteer flow. It creates a temporary SQLite database, applies the D1
migrations, submits a volunteer plan, approves it, and verifies that it appears
through the public stops API.

Run it directly with:

```bash
mise run test -- --run src/worker/activate-ri.acceptance.test.ts
```

The browser smoke test is intentionally opt-in because it starts Wrangler and a
real browser:

```bash
mise run e2e:activate-ri
```
```

- [ ] **Step 2: Update data-flow docs**

In `docs/activate-ri-2026/data-flow.md`, add a short testing note near the volunteer submission flow:

```md
The API path is covered by a real-SQL acceptance test that applies the checked-in
D1 migrations to a temporary SQLite database. The browser path is covered by the
opt-in `mise run e2e:activate-ri` smoke test.
```

- [ ] **Step 3: Run verification**

Run:

```bash
rtk npm test -- --run --reporter=dot
rtk npm run build
rtk mise run e2e:activate-ri
```

Expected:

- Vitest passes.
- Production build passes.
- Browser E2E passes.

If `npm run check` is run, note the existing unrelated `src/mise-tasks.test.ts` `node:fs` type issue unless it has been separately fixed.

## Execution Notes

- The API acceptance test should stay in the normal fast test suite.
- The browser E2E test should not run during normal `npm test`.
- Do not use production Cloudflare Access or production Turnstile in local E2E.
- Do not send real emails in these tests; the API acceptance test uses a fake `EMAIL` binding, and the browser E2E uses local test configuration.
- Keep this to one critical-path browser test unless another production incident proves a second browser flow is necessary.
