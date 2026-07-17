import { createHash } from "node:crypto";
import type {
  HandoffDiagnostic,
  HandoffPackage,
  HandoffValidationResult,
} from "../../shared/contracts/team";
import {
  HandoffPackageSchema,
  HandoffValidationResultSchema,
} from "../../shared/contracts/team";

const SECRET_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["credential-assignment", /(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*["']?[^\s,"'}]{8,}/i],
  ["credential-url", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i],
];

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function packageFingerprint(value: HandoffPackage): `sha256:${string}` {
  const material = structuredClone(value) as Record<string, unknown>;
  delete material.fingerprint;
  delete material.diagnostics;
  delete material.metrics;
  return sha256(canonicalJson(material));
}

export class HandoffPackageValidator {
  validate(
    input: unknown,
    limits: { maxPackageBytes: number; maxAttachmentBytes: number; maxAttachments: number },
  ): HandoffValidationResult {
    const started = performance.now();
    const diagnostics: HandoffDiagnostic[] = [];
    const raw = safeStringify(input);
    const sizeBytes = Buffer.byteLength(raw);
    if (sizeBytes > limits.maxPackageBytes) {
      diagnostics.push(error("package-too-large", `Package size ${sizeBytes} exceeds the ${limits.maxPackageBytes}-byte limit.`));
    }
    for (const [code, pattern] of SECRET_PATTERNS) {
      if (pattern.test(raw)) diagnostics.push(error(`secret-${code}`, "Secret-like material was detected. Remove it before transfer."));
    }
    const parsed = HandoffPackageSchema.safeParse(input);
    if (!parsed.success) {
      diagnostics.push(...parsed.error.issues.slice(0, 100).map((issue) => error("schema-invalid", issue.message, issue.path.join("."))));
      return HandoffValidationResultSchema.parse({ valid: false, diagnostics, sizeBytes, durationMs: performance.now() - started, validatedAt: new Date().toISOString() });
    }
    const packageData = parsed.data;
    if (packageData.attachments.length > limits.maxAttachments) diagnostics.push(error("too-many-attachments", "The package exceeds the configured attachment count."));
    if (packageData.attachments.length) diagnostics.push(error("attachment-body-unavailable", "Attachment metadata is present but this package format does not contain independently verified attachment bodies."));
    const attachmentBytes = packageData.attachments.reduce((total, item) => total + item.sizeBytes, 0);
    if (attachmentBytes > limits.maxAttachmentBytes) diagnostics.push(error("attachments-too-large", "Attachment metadata exceeds the configured aggregate byte limit."));
    for (const attachment of packageData.attachments) {
      if (attachment.archivePath && !safeRelativePath(attachment.archivePath)) diagnostics.push(error("unsafe-attachment-path", "Attachment archive path is unsafe.", attachment.archivePath));
    }
    for (const file of packageData.changedFiles) {
      if (!safeRelativePath(file.path)) diagnostics.push(error("unsafe-file-path", "Changed file path is unsafe.", file.path));
    }
    const calculatedFingerprint = packageFingerprint(packageData);
    if (calculatedFingerprint !== packageData.fingerprint) diagnostics.push(error("fingerprint-mismatch", "Package content does not match its recorded fingerprint."));
    if (packageData.expiresAt && Date.parse(packageData.expiresAt) < Date.now()) diagnostics.push(error("package-expired", "The handoff package has expired."));
    return HandoffValidationResultSchema.parse({
      valid: !diagnostics.some((item) => item.severity === "error"),
      diagnostics,
      calculatedFingerprint,
      sizeBytes,
      durationMs: performance.now() - started,
      validatedAt: new Date().toISOString(),
    });
  }
}

export class HandoffDiagnosticsService {
  inspect(input: unknown, limits: { maxPackageBytes: number; maxAttachmentBytes: number; maxAttachments: number }): HandoffDiagnostic[] {
    return new HandoffPackageValidator().validate(input, limits).diagnostics;
  }
}

export function decodeHandoffArtifact(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength > maxBytes) throw new Error("Handoff artifact exceeds the configured byte limit.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return bytes;
  if (bytes.byteLength < 30) throw new Error("Handoff ZIP is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("Unsupported ZIP structure.");
  const flags = view.getUint16(6, true); const method = view.getUint16(8, true);
  if (flags !== 0 || method !== 0) throw new Error("Only deterministic, unencrypted STORE ZIP handoff artifacts are supported.");
  const compressedSize = view.getUint32(18, true); const uncompressedSize = view.getUint32(22, true); const nameLength = view.getUint16(26, true); const extraLength = view.getUint16(28, true);
  if (compressedSize !== uncompressedSize || uncompressedSize > maxBytes) throw new Error("ZIP entry size is invalid or exceeds the configured limit.");
  const start = 30 + nameLength + extraLength; const end = start + uncompressedSize;
  if (start > bytes.byteLength || end > bytes.byteLength) throw new Error("Handoff ZIP entry is truncated.");
  const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(30, 30 + nameLength));
  if (name !== "handoff.json") throw new Error("The ZIP must contain a single root handoff.json entry.");
  const payload = bytes.slice(start, end);
  if (zipCrc32(payload) !== view.getUint32(14, true)) throw new Error("Handoff ZIP checksum does not match its JSON entry.");
  const endOffset = findEndOfCentralDirectory(bytes); if (endOffset < 0) throw new Error("Handoff ZIP central directory is missing.");
  const endView = new DataView(bytes.buffer, bytes.byteOffset + endOffset, bytes.byteLength - endOffset);
  if (endView.getUint16(8, true) !== 1 || endView.getUint16(10, true) !== 1) throw new Error("The handoff ZIP must contain exactly one entry.");
  return payload;
}

function safeRelativePath(value: string): boolean {
  return Boolean(value) && !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:[\\/]/.test(value) && !value.split(/[\\/]/).includes("..") && !/[\0\r\n]/.test(value);
}

function error(code: string, message: string, path?: string): HandoffDiagnostic {
  return { code, severity: "error", message, ...(path ? { path } : {}) };
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return "[unserializable]"; }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset;
  }
  return -1;
}

function zipCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
