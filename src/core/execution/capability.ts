/**
 * Types and interfaces for Keystone capability discovery and execution configuration.
 *
 * This module handles the discovery, categorization, and configuration of execution capabilities
 * that can be used in Keystone workflows.
 */

/**
 * Available capability types that can be discovered in the VS Code environment
 */
export type CapabilityType =
  | "agent"
  | "skill"
  | "instruction"
  | "languageModelProvider"
  | "command"
  | "prompt"
  | "extensionContribution";

/**
 * State of a discovered capability
 */
export type CapabilityState =
  | "available"
  | "partially-available"
  | "unavailable"
  | "unsupported"
  | "invalid"
  | "permission-required";

/**
 * Base interface for all capabilities
 */
export interface Capability {
  /**
   * Stable identifier for the capability
   */
  id: string;

  /**
   * Human-readable display name
   */
  name: string;

  /**
   * Type of capability
   */
  type: CapabilityType;

  /**
   * Source where the capability was discovered
   */
  source: string;

  /**
   * Description of what the capability does
   */
  description?: string;

  /**
   * Current availability state
   */
  state: CapabilityState;

  /**
   * Timestamp of when this capability was last discovered
   */
  lastDiscovered: string;

  /**
   * Diagnostics when unavailable
   */
  diagnostics?: string[];

  /**
   * Whether this capability supports direct invocation
   */
  supportsDirectInvocation?: boolean;

  /**
   * Whether this capability supports manual handoff
   */
  supportsManualHandoff?: boolean;

  /**
   * Supported input types
   */
  supportedInputTypes?: string[];

  /**
   * Supported output types
   */
  supportedOutputTypes?: string[];

  /**
   * Reference to the file or extension that provides this capability
   */
  reference?: string;
}

/**
 * Agent capability interface
 */
export interface AgentCapability extends Capability {
  type: "agent";

  /**
   * Stage types this agent can handle
   */
  supportedStageTypes?: string[];

  /**
   * Whether this agent supports direct invocation
   */
  supportsDirectInvocation: boolean;

  /**
   * Whether this agent supports manual handoff
   */
  supportsManualHandoff: boolean;

  /**
   * Available invocation modes
   */
  invocationModes?: (
    "direct" | "chat-handoff" | "clipboard-handoff" | "manual" | "deterministic"
  )[];
}

/**
 * Skill capability interface
 */
export interface SkillCapability extends Capability {
  type: "skill";

  /**
   * Applicable SDLC stage types
   */
  applicableStageTypes: string[];

  /**
   * Required capabilities for this skill
   */
  requiredCapabilities: string[];

  /**
   * Instruction references that this skill might use
   */
  instructionReferences?: string[];

  /**
   * Optional prompt fragment
   */
  promptFragment?: string;

  /**
   * Version or content hash
   */
  version?: string;
}

/**
 * Instruction capability interface
 */
export interface InstructionCapability extends Capability {
  type: "instruction";

  /**
   * File path when applicable
   */
  filePath?: string;

  /**
   * Scope of the instruction (repository, workspace, user, etc.)
   */
  scope: "repository" | "workspace" | "user" | "system" | "agent-specific" | "stage-specific";

  /**
   * Precedence order (lower numbers have higher precedence)
   */
  precedence: number;

  /**
   * Content hash for change tracking
   */
  contentHash?: string;

  /**
   * Whether this instruction is enabled
   */
  enabled: boolean;

  /**
   * Token size estimate
   */
  tokenSize?: number;
}

/**
 * Language model provider capability
 */
export interface LanguageModelProviderCapability extends Capability {
  type: "languageModelProvider";

  /**
   * Provider name (e.g., "openai", "anthropic", "copilot")
   */
  providerName: string;

  /**
   * Supported models
   */
  supportedModels: string[];

  /**
   * Whether this provider supports direct invocation
   */
  supportsDirectInvocation: boolean;
}

/**
 * Command capability
 */
export interface CommandCapability extends Capability {
  type: "command";

  /**
   * Command name (e.g., "keystone.startWorkflow")
   */
  commandName: string;

  /**
   * Whether this command is available
   */
  available: boolean;
}

/**
 * Prompt capability
 */
export interface PromptCapability extends Capability {
  type: "prompt";

  /**
   * File path or identifier for the prompt
   */
  promptPath?: string;

  /**
   * Content or template of the prompt
   */
  content?: string;

  /**
   * Expected output format
   */
  expectedOutputFormat?: string;
}

/**
 * Extension contribution capability
 */
export interface ExtensionContributionCapability extends Capability {
  type: "extensionContribution";

  /**
   * Extension ID that contributed this capability
   */
  extensionId: string;

  /**
   * Contribution type (e.g., "agent", "skill", "instruction")
   */
  contributionType: string;
}

/**
 * Capability discovery result
 */
export interface CapabilityDiscoveryResult {
  /**
   * List of discovered capabilities
   */
  capabilities: Capability[];

  /**
   * Timestamp of discovery
   */
  timestamp: string;

  /**
   * Any errors encountered during discovery
   */
  errors?: string[];
}
