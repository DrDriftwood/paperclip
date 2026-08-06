import { describe, expect, it } from "vitest";
import { REDACTED_LOG_HEADER_PATHS } from "../middleware/redacted-log-headers.js";

describe("REDACTED_LOG_HEADER_PATHS", () => {
  it("covers the session cookie on the request — the LAR-928 leak", () => {
    expect(REDACTED_LOG_HEADER_PATHS).toContain("req.headers.cookie");
  });

  it("covers set-cookie on the response using pino bracket syntax", () => {
    expect(REDACTED_LOG_HEADER_PATHS).toContain('res.headers["set-cookie"]');
  });

  it("keeps the pre-existing authorization redaction", () => {
    expect(REDACTED_LOG_HEADER_PATHS).toContain("req.headers.authorization");
  });

  it("covers every header name on both req and res", () => {
    const req = REDACTED_LOG_HEADER_PATHS.filter((p) => p.startsWith("req."));
    const res = REDACTED_LOG_HEADER_PATHS.filter((p) => p.startsWith("res."));

    expect(req).toHaveLength(res.length);
    expect(req.map((p) => p.slice(4))).toEqual(res.map((p) => p.slice(4)));
  });

  it("quotes only the header names pino cannot parse as bare identifiers", () => {
    for (const path of REDACTED_LOG_HEADER_PATHS) {
      const suffix = path.replace(/^(req|res)\.headers/, "");
      if (suffix.includes("-")) {
        expect(suffix).toMatch(/^\["[a-z0-9-]+"\]$/);
      } else {
        expect(suffix).toMatch(/^\.[a-z][a-z0-9]*$/);
      }
    }
  });

  it("emits no duplicate paths", () => {
    expect(new Set(REDACTED_LOG_HEADER_PATHS).size).toBe(REDACTED_LOG_HEADER_PATHS.length);
  });
});
