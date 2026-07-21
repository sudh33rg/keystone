/**
 * SensitiveContextFilter
 *
 * Scans candidate context for secrets and sensitive local configuration before
 * rendering the prompt. For high-confidence secrets:
 *  - exclude the exact value
 *  - preserve a redacted structural reference when useful
 *  - block delegation if the secret is essential and cannot be safely represented
 *  - show a clear warning
 *
 * Does NOT store unredacted secret values in any persisted context record.
 * Reuses the shared `redactSecrets` utility.
 */

import type { ContextItem, ContextWarning } from "../../shared/contracts/contextPackage";
import { ContextItemSchema, ContextWarningSchema } from "../../shared/contracts/contextPackage";
import { detectSecrets, redactSecrets } from "./compressionUtils";

export interface SensitiveFilterResult {
  items: ContextItem[];
  warnings: ContextWarning[];
  /** True if delegation must be blocked (essential secret could not be safe). */
  blocked: boolean;
  /** Items to exclude entirely (secret that cannot be represented safely). */
  exclusions: Array<{
    item: ContextItem;
    reason: "secret";
    tokensRemoved: number;
    restorable: boolean;
  }>;
}

export class SensitiveContextFilter {
  /**
   * @param essentialSecretItemIds Items whose value is essential for the task
   *   (e.g. a test fixture that genuinely must contain a token). If such an item
   *   carries a high-confidence secret, delegation is blocked.
   */
  filter(
    items: ContextItem[],
    essentialSecretItemIds: Set<string> = new Set(),
  ): SensitiveFilterResult {
    const warnings: ContextWarning[] = [];
    const exclusions: SensitiveFilterResult["exclusions"] = [];
    const out: ContextItem[] = [];
    let blocked = false;

    for (const item of items) {
      const secrets = detectSecrets(item.content);
      if (secrets.length === 0) {
        out.push(item);
        continue;
      }
      if (essentialSecretItemIds.has(item.id)) {
        warnings.push(
          this.warn(
            "essential-secret-blocked",
            "error",
            `Item ${item.id} contains an essential secret that cannot be safely represented; delegation is blocked.`,
          ),
        );
        blocked = true;
        exclusions.push({
          item,
          reason: "secret",
          tokensRemoved: item.tokenCount,
          restorable: false,
        });
        continue;
      }
      const { redacted, redactedCount } = redactSecrets(item.content);
      warnings.push(
        this.warn(
          "secret-redacted",
          "warning",
          `Redacted ${redactedCount} secret value(s) in item ${item.id}; unredacted values are never persisted.`,
        ),
      );
      out.push(
        ContextItemSchema.parse({
          ...item,
          content: redacted,
          compressedContentHash: `sha256:redacted:${item.rawContentHash}`,
          reasons: [...item.reasons, "Secret values redacted; structural reference preserved."],
        }),
      );
    }

    return { items: out, warnings, blocked, exclusions };
  }

  private warn(
    code: string,
    severity: ContextWarning["severity"],
    message: string,
  ): ContextWarning {
    return ContextWarningSchema.parse({ code, severity, message });
  }
}
