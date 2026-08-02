import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual
} from "node:crypto";
import {
  EncryptionError,
  SecretDetectedError,
  TaskStateValidationError,
  type RedactionReport
} from "./contracts";

export interface EncryptedHandoffEnvelope {
  format: "keystone-handoff-encrypted-v1";
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

const deriveKey = (passphrase: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(passphrase, salt, 32, (error, key) => (error ? reject(error) : resolve(key)))
  );
export async function encryptHandoffPackage(
  plaintext: string,
  passphrase: string
): Promise<string> {
  if (passphrase.length < 12)
    throw new TaskStateValidationError("Use a handoff passphrase with at least 12 characters.");
  if (passphrase.length > 1024)
    throw new TaskStateValidationError("The handoff passphrase is too long.");
  try {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const key = await deriveKey(passphrase, salt);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    key.fill(0);
    const envelope: EncryptedHandoffEnvelope = {
      format: "keystone-handoff-encrypted-v1",
      kdf: "scrypt",
      cipher: "aes-256-gcm",
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64")
    };
    return JSON.stringify(envelope);
  } catch {
    throw new EncryptionError();
  }
}
export async function decryptHandoffPackage(
  serialized: string,
  passphrase: string
): Promise<string> {
  if (!passphrase) throw new TaskStateValidationError("Enter the handoff passphrase.");
  if (passphrase.length > 1024)
    throw new TaskStateValidationError("The handoff passphrase is too long.");
  if (Buffer.byteLength(serialized, "utf8") > 15 * 1024 * 1024)
    throw new TaskStateValidationError("The encrypted handoff package exceeds the 15 MB limit.");
  try {
    const envelope = JSON.parse(serialized) as Partial<EncryptedHandoffEnvelope>;
    if (
      envelope.format !== "keystone-handoff-encrypted-v1" ||
      envelope.kdf !== "scrypt" ||
      envelope.cipher !== "aes-256-gcm" ||
      !envelope.salt ||
      !envelope.nonce ||
      !envelope.ciphertext ||
      !envelope.authTag
    )
      throw new Error("invalid envelope");
    const key = await deriveKey(passphrase, Buffer.from(envelope.salt, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    key.fill(0);
    return plaintext;
  } catch {
    throw new EncryptionError();
  }
}

const patterns = [
  {
    category: "private-key",
    high: true,
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  },
  {
    category: "github-token",
    high: true,
    re: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g
  },
  {
    category: "jwt",
    high: true,
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
  },
  {
    category: "credential-assignment",
    high: true,
    re: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{8,}/gi
  },
  {
    category: "authorization-header",
    high: true,
    re: /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s]+/gi
  }
];
const excludedPath =
  /(^|\/)(?:\.env(?:\..*)?|\.ssh|credentials(?:\.json)?|id_(?:rsa|ed25519))(?:$|\/)/i;

export function scanAndRedact<T>(input: T): { value: T; report: RedactionReport } {
  const findings: RedactionReport["findings"] = [];
  const removed = new Set<string>();
  const paths: string[] = [];
  const visit = (value: unknown, path: string): unknown => {
    if (typeof value === "string") {
      if ((/path|file/i.test(path) || path.includes("Excerpts")) && excludedPath.test(value)) {
        removed.add("excluded-path");
        paths.push(path);
        return "[REDACTED:EXCLUDED_PATH]";
      }
      let current = value;
      for (const pattern of patterns) {
        pattern.re.lastIndex = 0;
        if (pattern.re.test(current)) {
          findings.push({
            category: pattern.category,
            path,
            confidence: pattern.high ? "HIGH" : "MEDIUM"
          });
          removed.add(pattern.category);
          pattern.re.lastIndex = 0;
          current = current.replace(pattern.re, `[REDACTED:${pattern.category.toUpperCase()}]`);
        }
      }
      return current;
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}[${index}]`));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          visit(child, path ? `${path}.${key}` : key)
        ])
      );
    return value;
  };
  const value = visit(input, "") as T;
  const report = {
    scannedAt: new Date().toISOString(),
    removedCategories: [...removed],
    redactedPaths: paths,
    findings,
    safeToShare: true
  };
  return { value, report };
}
export function assertNoHighConfidenceSecrets(value: unknown): void {
  const result = scanAndRedact(value);
  if (result.report.findings.some((f) => f.confidence === "HIGH")) throw new SecretDetectedError();
}
export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function safeChecksumEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
