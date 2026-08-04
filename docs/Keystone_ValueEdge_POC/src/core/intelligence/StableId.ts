const encoder = new TextEncoder();

export function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export function normalizeSignature(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : undefined;
}

export async function sha256Bytes(value: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(encoder.encode(value));
}

export async function stableId(
  prefix: string,
  ...parts: Array<string | number | undefined>
): Promise<string> {
  const canonical = parts.map((part) => String(part ?? "").normalize("NFC")).join("\u001f");
  const digest = await sha256Text(canonical);
  return `${prefix}:${digest.slice("sha256:".length, "sha256:".length + 32)}`;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
