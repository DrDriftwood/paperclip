// Redaction for HTTP log payloads.
//
// `customProps` in logger.ts copies `req.body` / `req.params` / `req.query`
// verbatim into the 4xx/5xx log lines so operators can diagnose. That means
// Better Auth's `POST /api/auth/sign-in/email` body (which has the user's
// plaintext password) and similar payloads (sign-up, reset-password, API
// keys via Authorization header equivalents) end up on disk.
//
// This walker returns a shallow copy of the input with values for sensitive
// keys replaced with the literal string "[REDACTED]". Recurses into nested
// objects/arrays. Caps depth so a hostile or accidental cycle can't pin
// the logger.

// Keys are matched after normalization (lower-cased, `-`/`_`/spaces stripped),
// so a single entry covers `access_token`, `accessToken` and `access-token`.
// The dashed form matters because header bags reach this walker via adapter
// config bodies, where the key really is `set-cookie`.
const SENSITIVE_KEYS = new Set<string>([
  "password",
  "currentpassword",
  "newpassword",
  "passwordconfirmation",
  "passwordconfirm",
  "confirmpassword",
  "secret",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "authtoken",
  "sessiontoken",
  "privatekey",
].map(normalizeKey));

const MAX_DEPTH = 6;
const REDACTED = "[REDACTED]";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (depth + 1 > MAX_DEPTH) return undefined;
    return value.map((entry) => redactSensitive(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSensitive(entry, depth + 1);
  }
  return out;
}
