// Header allow-list of credential-bearing HTTP headers whose VALUES must never
// reach `server.log`.
//
// `pino-http`'s default `req`/`res` serializers copy the whole header bag into
// every request log line. Only `authorization` was redacted, so the cockpit's
// session cookie (`paperclip-default.session_token=...`) was written in clear
// text on every request the UI made (LAR-928).
//
// pino's `redact` replaces the VALUE with "[Redacted]" and leaves the key in
// place, so header names stay visible for debugging. Paths that never appear on
// a given request are simply no-ops.
//
// Node lower-cases both incoming request header names and the names returned by
// `res.getHeaders()`, so every entry here is lower-case by construction.

const REDACTED_HEADER_NAMES = [
  // Standard credential carriers.
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  // Widely used API-key conventions.
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-session-token",
  "x-csrf-token",
  "x-xsrf-token",
  // Paperclip-specific credential headers read by this server.
  // See server/src/routes/access.ts and packages/adapters/hermes.
  "x-openclaw-token",
  "x-openclaw-auth",
  "x-hermes-session-key",
  // Bearer-style tokens read straight off the incoming request elsewhere in
  // the server; without these the raw token would land in the request log.
  // See server/src/routes/health.ts and server/src/middleware/auth.ts.
  "x-paperclip-dev-server-status-token",
  "x-paperclip-cloud-tenant-token",
  // Cloud provider session credentials that can ride on proxied requests.
  "x-amz-security-token",
  // Webhook HMAC signatures read off inbound requests. These are shared-secret
  // derived MACs; logging them raw is a credential-shaped leak.
  // See server/src/routes/routines.ts.
  "x-paperclip-signature",
  "x-hub-signature-256",
] as const;

function headerPath(root: "req" | "res", name: string): string {
  // pino's redact syntax needs bracket notation for names containing `-`.
  return /^[a-z][a-z0-9]*$/.test(name)
    ? `${root}.headers.${name}`
    : `${root}.headers["${name}"]`;
}

/**
 * pino `redact` paths covering credential-bearing headers on both the request
 * and the response serializer output.
 */
export const REDACTED_LOG_HEADER_PATHS: string[] = REDACTED_HEADER_NAMES.flatMap(
  (name) => [headerPath("req", name), headerPath("res", name)],
);
