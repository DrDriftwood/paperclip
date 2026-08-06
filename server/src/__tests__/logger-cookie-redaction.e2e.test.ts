// End-to-end proof for LAR-928: drive a real request through the real
// `httpLogger` and assert the session cookie never reaches the log file.
//
// `middleware/logger.ts` resolves its log directory at import time, so
// PAPERCLIP_LOG_DIR must be set before the dynamic import below.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Fabricated value. Never put a real session token in a fixture.
const FAKE_SESSION_COOKIE =
  "paperclip-default.session_token=FAKE-LAR928-NOT-A-REAL-TOKEN.FAKE-SIGNATURE";
const FAKE_SET_COOKIE =
  "paperclip-default.session_token=FAKE-LAR928-RESPONSE-TOKEN; Path=/; HttpOnly";

let logDir: string;
let logFile: string;
let server: import("node:http").Server;
let baseUrl: string;

async function readLogWhenNonEmpty(timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(logFile)) {
      const body = fs.readFileSync(logFile, "utf8");
      if (body.includes("/api/e2e-cookie-redaction")) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`log line never appeared in ${logFile}`);
}

beforeAll(async () => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "lar928-"));
  logFile = path.join(logDir, "server.log");
  process.env.PAPERCLIP_LOG_DIR = logDir;

  const { httpLogger } = await import("../middleware/logger.js");

  const app = express();
  app.use(httpLogger);
  app.get("/api/e2e-cookie-redaction", (_req, res) => {
    res.setHeader("set-cookie", FAKE_SET_COOKIE);
    res.status(200).json({ ok: true });
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await fetch(`${baseUrl}/api/e2e-cookie-redaction`, {
    headers: {
      cookie: FAKE_SESSION_COOKIE,
      authorization: "Bearer FAKE-LAR928-BEARER",
      "x-api-key": "FAKE-LAR928-API-KEY",
      "user-agent": "lar928-e2e",
    },
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe("httpLogger cookie redaction (LAR-928)", () => {
  it("writes no session_token value to the log file", async () => {
    const body = await readLogWhenNonEmpty();

    expect(body).not.toContain("session_token=");
    expect(body).not.toContain("FAKE-LAR928-NOT-A-REAL-TOKEN");
    expect(body).not.toContain("FAKE-LAR928-RESPONSE-TOKEN");
  });

  it("redacts the other credential headers on the same request", async () => {
    const body = await readLogWhenNonEmpty();

    expect(body).not.toContain("FAKE-LAR928-BEARER");
    expect(body).not.toContain("FAKE-LAR928-API-KEY");
  });

  it("does not over-redact: header NAMES and non-secret fields stay readable", async () => {
    const body = await readLogWhenNonEmpty();

    // Header names survive so the log is still useful for debugging.
    expect(body).toContain("cookie");
    expect(body).toContain("authorization");
    expect(body).toContain("x-api-key");
    // Non-secret request detail survives.
    expect(body).toContain("lar928-e2e");
    expect(body).toContain("/api/e2e-cookie-redaction");
    expect(body).toContain("200");
    // And the values that were removed are visibly censored, not dropped.
    expect(body).toContain("[Redacted]");
  });
});
