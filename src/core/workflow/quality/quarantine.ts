import fs from "node:fs";
import path from "node:path";

// --- Types ---

export interface QuarantineEntry {
  testPath: string;
  reason: string;
  flakinessScore: number;
  quarantinedAt: number;
  expiresAt?: number;
  autoQuarantined: boolean;
}

export interface QuarantineStore {
  add(entry: QuarantineEntry): void;
  remove(testPath: string): void;
  list(): QuarantineEntry[];
  isQuarantined(testPath: string): boolean;
  get(testPath: string): QuarantineEntry | undefined;
  autoQuarantine(testPath: string, flakinessScore: number, reason?: string): void;
}

// --- Defaults ---

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- In-memory store ---

class InMemoryStore {
  private entries: Map<string, QuarantineEntry> = new Map();

  add(entry: QuarantineEntry): void {
    this.entries.set(entry.testPath, entry);
  }

  remove(testPath: string): void {
    this.entries.delete(testPath);
  }

  list(): QuarantineEntry[] {
    return Array.from(this.entries.values());
  }

  isQuarantined(testPath: string): boolean {
    const entry = this.entries.get(testPath);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.entries.delete(testPath);
      return false;
    }
    return true;
  }

  get(testPath: string): QuarantineEntry | undefined {
    const entry = this.entries.get(testPath);
    if (entry && entry.expiresAt && Date.now() > entry.expiresAt) {
      this.entries.delete(testPath);
      return undefined;
    }
    return entry;
  }
}

// --- Persistence layer ---

interface QuarantinePayload {
  entries: QuarantineEntry[];
  threshold: number;
}

function persist(workspaceRoot: string, entries: QuarantineEntry[], threshold: number): void {
  const payload: QuarantinePayload = { entries, threshold };
  const filePath = path.join(workspaceRoot, ".keystone", "flaky_tests.json");
  fs.mkdirSync(path.join(workspaceRoot, ".keystone"), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function load(workspaceRoot: string): { entries: QuarantineEntry[]; threshold: number } {
  try {
    const filePath = path.join(workspaceRoot, ".keystone", "flaky_tests.json");
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as QuarantinePayload;
  } catch {
    // Corrupted or missing file — return fallback (same pattern as JsonStorage).
    return { entries: [], threshold: DEFAULT_THRESHOLD };
  }
}

// --- Public factory ---

export function createQuarantineStore(
  workspaceRoot: string,
  options: { threshold?: number; ttlMs?: number } = {}
): QuarantineStore {
  const store = new InMemoryStore();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  // Load persisted entries
  const payload = load(workspaceRoot);
  for (const entry of payload.entries) {
    if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
      store.add(entry);
    }
  }

  // Auto-quarantine: quarantine a test if its flakiness score exceeds the threshold.
  function autoQuarantine(
    testPath: string,
    flakinessScore: number,
    reason = "Auto-quarantined: flakiness above threshold"
  ): void {
    if (flakinessScore >= threshold && !store.isQuarantined(testPath)) {
      const entry: QuarantineEntry = {
        testPath,
        reason,
        flakinessScore,
        quarantinedAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        autoQuarantined: true
      };
      store.add(entry);
      persist(workspaceRoot, store.list(), threshold);
    }
  }

  return {
    add(entry: QuarantineEntry): void {
      store.add(entry);
      persist(workspaceRoot, store.list(), threshold);
    },

    remove(testPath: string): void {
      store.remove(testPath);
      persist(workspaceRoot, store.list(), threshold);
    },

    list(): QuarantineEntry[] {
      return store.list();
    },

    isQuarantined(testPath: string): boolean {
      return store.isQuarantined(testPath);
    },

    get(testPath: string): QuarantineEntry | undefined {
      return store.get(testPath);
    },

    autoQuarantine
  };
}
