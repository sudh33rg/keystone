const SENSITIVE_ASSIGNMENT = /\b(token|password|secret|api[_-]?key|authorization)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redact(value: unknown): string {
  const text = typeof value === "string" ? value : safeSerialize(value);
  return text
    .replace(PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`);
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
