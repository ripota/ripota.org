import {
  execFileSync,
  spawn,
} from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ActivateRiServer = {
  origin: string;
  output(): string;
  waitForOutput(pattern: RegExp, timeoutMs?: number): Promise<RegExpMatchArray>;
  waitForEmailText(subject: string, timeoutMs?: number): Promise<string>;
  accountOnlySessionToken?: string;
  stop(): Promise<void>;
};

export async function startActivateRiServer(
  options: { legacyLinkIssuanceEnabled?: boolean; seedAccountOnly?: boolean } = {},
): Promise<ActivateRiServer> {
  const port = await freePort();
  const inspectorPort = await freePort(port);
  const persistTo = mkdtempSync(join(tmpdir(), "ripota-e2e-wrangler-"));
  prepareLocalDatabase(persistTo);
  const accountOnlySessionToken = options.seedAccountOnly
    ? seedAccountOnlySession(persistTo)
    : undefined;
  const wranglerArgs = [
    "dev",
    "--env",
    "local",
    "--port",
    String(port),
    "--inspector-port",
    String(inspectorPort),
    "--local",
    "--persist-to",
    persistTo,
  ];
  if (options.legacyLinkIssuanceEnabled) {
    wranglerArgs.push("--var", "AUTH_LEGACY_LINK_ISSUANCE_ENABLED:true");
  }
  const child = spawn(
    "./node_modules/.bin/wrangler",
    wranglerArgs,
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const logs = { value: "" };
  child.stdout?.on("data", (chunk) => {
    logs.value += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    logs.value += chunk.toString();
  });

  const origin = `http://localhost:${port}`;
  try {
    await waitForServerReady(child, origin, logs);
  } catch (error) {
    child.kill("SIGTERM");
    rmSync(persistTo, { recursive: true, force: true });
    throw error;
  }

  return {
    origin,
    accountOnlySessionToken,
    output() {
      return logs.value;
    },
    async waitForOutput(pattern, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = logs.value.match(pattern);
        if (match) return match;
        await delay(50);
      }
      throw new Error(`Timed out waiting for local server output matching ${pattern}.`);
    },
    async waitForEmailText(subject, timeoutMs = 10_000) {
      const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`Subject: ${escaped}\\s+Text: ([^\\r\\n]+)`);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = logs.value.match(pattern);
        if (match) return readFileSync(match[1].trim(), "utf8");
        await delay(50);
      }
      throw new Error(`Timed out waiting for local email with subject ${subject}.`);
    },
    async stop() {
      await stopProcess(child);
      rmSync(persistTo, { recursive: true, force: true });
    },
  };
}

function seedAccountOnlySession(persistTo: string): string {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const sql = `
    INSERT INTO auth_users (
      id, webauthn_user_id, display_name, created_at, updated_at
    ) VALUES (
      'e2e-account-only', 'e2e-webauthn-account-only',
      'Synthetic account holder', '${createdAt}', '${createdAt}'
    );
    INSERT INTO auth_user_emails (
      user_id, email_normalized, is_primary, verified_at, created_at, updated_at
    ) VALUES (
      'e2e-account-only', 'account-only@example.invalid', 1,
      '${createdAt}', '${createdAt}', '${createdAt}'
    );
    INSERT INTO auth_sessions (
      id, token_hash, user_id, purpose, authentication_method,
      authenticated_at, passkey_verified_at, created_at, expires_at, last_used_at
    ) VALUES (
      'e2e-account-only-session', '${tokenHash}', 'e2e-account-only',
      'authenticated', 'passkey', '${createdAt}', '${createdAt}',
      '${createdAt}', '${expiresAt}', '${createdAt}'
    );
  `;
  execFileSync(
    "./node_modules/.bin/wrangler",
    [
      "d1",
      "execute",
      "ripota-org",
      "--local",
      "--env",
      "local",
      "--persist-to",
      persistTo,
      "--command",
      sql,
    ],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  return token;
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  let exited = false;
  const exitPromise = once(child, "exit").then(() => {
    exited = true;
  });

  child.kill("SIGTERM");
  await Promise.race([exitPromise, delay(3000)]);

  if (!exited) {
    child.kill("SIGKILL");
    await Promise.race([exitPromise, delay(1000)]);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyLocalMigrations(persistTo: string): void {
  execFileSync(
    "./node_modules/.bin/wrangler",
    [
      "d1",
      "migrations",
      "apply",
      "ripota-org",
      "--local",
      "--env",
      "local",
      "--persist-to",
      persistTo,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function prepareLocalDatabase(persistTo: string): void {
  const databaseTemplate = process.env.RIPOTA_E2E_D1_TEMPLATE;
  if (databaseTemplate) {
    cpSync(databaseTemplate, persistTo, { recursive: true });
    return;
  }

  applyLocalMigrations(persistTo);
}

async function waitForServerReady(
  child: ReturnType<typeof spawn>,
  origin: string,
  logs: { value: string },
): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited early:\n${logs.value}`);
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
  throw new Error(`Timed out waiting for wrangler dev:\n${logs.value}`);
}

async function freePort(excludedPort?: number): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  await once(server, "close");

  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local port.");
  }

  if (address.port === excludedPort) {
    return freePort(excludedPort);
  }

  return address.port;
}
