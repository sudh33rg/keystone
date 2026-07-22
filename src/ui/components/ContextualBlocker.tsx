import { Icon } from "./Icon";
import type { KeystoneUiAction } from "./UiState";

export type BlockerCategory =
  | "capability-unavailable"
  | "intelligence-incomplete"
  | "stale-data"
  | "configuration-missing"
  | "approval-required"
  | "context-incomplete"
  | "execution-failed"
  | "validation-failed"
  | "policy-violation"
  | "source-conflict"
  | "migration-issue"
  | "storage-issue"
  | "unsupported-feature"
  | "user-action-required";

export interface ContextualBlockerModel {
  id: string;
  category: BlockerCategory;
  title: string;
  detail: string;
  resolution?: string;
  actions?: KeystoneUiAction[];
}

const CATEGORY_LABEL: Record<BlockerCategory, string> = {
  "capability-unavailable": "Capability unavailable",
  "intelligence-incomplete": "Intelligence incomplete",
  "stale-data": "Stale data",
  "configuration-missing": "Configuration missing",
  "approval-required": "Approval required",
  "context-incomplete": "Context incomplete",
  "execution-failed": "Execution failed",
  "validation-failed": "Validation failed",
  "policy-violation": "Policy violation",
  "source-conflict": "Source conflict",
  "migration-issue": "Migration issue",
  "storage-issue": "Storage issue",
  "unsupported-feature": "Unsupported feature",
  "user-action-required": "Action required",
};

export function ContextualBlocker({
  blocker,
}: {
  blocker: ContextualBlockerModel;
}): React.JSX.Element {
  return (
    <section
      className="ui-state contextual-blocker"
      role="status"
      aria-labelledby={`${blocker.id}-title`}
    >
      <div className="blocker-head">
        <Icon name="warning" size={16} />
        <strong id={`${blocker.id}-title`}>
          {blocker.title || CATEGORY_LABEL[blocker.category]}
        </strong>
        <span className="blocker-category">{CATEGORY_LABEL[blocker.category]}</span>
      </div>
      <p>{blocker.detail}</p>
      {blocker.resolution && (
        <p className="blocker-resolution">
          <strong>How to resolve:</strong> {blocker.resolution}
        </p>
      )}
      {blocker.actions && blocker.actions.length > 0 && (
        <div className="button-row" aria-label="Blocker actions">
          {blocker.actions.map((action) => (
            <button
              key={action.id}
              className={action.kind === "primary" ? "primary-button" : "ghost-button"}
              onClick={action.run}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContextualBlockerList({
  blockers,
}: {
  blockers: ContextualBlockerModel[];
}): React.JSX.Element | null {
  if (blockers.length === 0) return null;
  return (
    <div className="contextual-blocker-list" aria-label="Workflow blockers">
      {blockers.map((blocker) => (
        <ContextualBlocker key={blocker.id} blocker={blocker} />
      ))}
    </div>
  );
}
