/**
 * Execution profile model and related interfaces for Keystone workflows.
 *
 * This module defines the execution profile structure that allows users to configure
 * how each SDLC stage should be executed.
 */

/**
 * Interface for an execution profile that defines how a workflow stage should be executed
 */
export interface ExecutionProfile {
  /**
   * Unique identifier for the execution profile
   */
  id: string;

  /**
   * Human-readable name for the execution profile
   */
  name: string;

  /**
   * Description of what this profile does
   */
  description?: string;

  /**
   * Executor configuration
   */
  executor: {
    /**
     * ID of the selected agent
     */
    agentId: string;

    /**
     * How the agent should be invoked
     */
    invocationMode: "direct" | "chat-handoff" | "clipboard-handoff" | "manual" | "deterministic";

    /**
     * Fallback agent ID when preferred agent is unavailable
     */
    fallbackAgentId?: string;

    /**
     * Fallback invocation mode
     */
    fallbackMode?: "manual" | "chat-handoff" | "block";
  };

  /**
   * Skills to be used in this execution profile
   */
  skills: Array<{
    /**
     * ID of the skill
     */
    skillId: string;

    /**
     * Whether this skill is enabled
     */
    enabled: boolean;

    /**
     * Order in which the skill should be applied (lower numbers first)
     */
    order: number;
  }>;

  /**
   * Instructions to be used in this execution profile
   */
  instructions: Array<{
    /**
     * ID of the instruction
     */
    instructionId: string;

    /**
     * Whether this instruction is enabled
     */
    enabled: boolean;

    /**
     * Order in which the instruction should be applied (lower numbers first)
     */
    order: number;
  }>;

  /**
   * Context configuration
   */
  context: {
    /**
     * Profile ID that this context profile references (optional)
     */
    profileId?: string;

    /**
     * Maximum token budget for the prompt package
     */
    tokenBudget: number;

    /**
     * Whether to include workflow intent in the prompt
     */
    includeWorkflowIntent: boolean;

    /**
     * Whether to include specification in the prompt
     */
    includeSpecification: boolean;

    /**
     * Whether to include acceptance criteria in the prompt
     */
    includeAcceptanceCriteria: boolean;

    /**
     * Whether to include stage history in the prompt
     */
    includeStageHistory: boolean;

    /**
     * Whether to include validation evidence in the prompt
     */
    includeValidationEvidence: boolean;

    /**
     * Whether to include user-pinned context in the prompt
     */
    includeUserPinnedContext: boolean;
  };

  /**
   * Control configuration
   */
  control: {
    /**
     * Whether user approval is required before delegation
     */
    approvalRequired: boolean;

    /**
     * Whether automatic invocation is allowed
     */
    allowAutomaticInvocation: boolean;

    /**
     * Maximum number of retries for failed executions
     */
    retryLimit: number;

    /**
     * Timeout in seconds for execution
     */
    timeoutSeconds?: number;

    /**
     * Whether prompt preview is required before delegation
     */
    requirePromptPreview: boolean;

    /**
     * Whether output review is required after execution
     */
    requireOutputReview: boolean;
  };

  /**
   * Output configuration
   */
  output: {
    /**
     * Expected output type
     */
    contractType:
      | "implementation"
      | "analysis"
      | "test-plan"
      | "test-changes"
      | "review-findings"
      | "documentation"
      | "custom";

    /**
     * Expected artifact names
     */
    expectedArtifacts: string[];

    /**
     * Whether structured result is required
     */
    requireStructuredResult: boolean;

    /**
     * Custom schema ID if contractType is "custom"
     */
    customSchemaId?: string;
  };

  /**
   * Metadata about this profile
   */
  metadata: {
    /**
     * When this profile was created
     */
    createdAt: string;

    /**
     * When this profile was last updated
     */
    updatedAt: string;

    /**
     * Source of this profile (built-in, workspace, user)
     */
    source: "built-in" | "workspace" | "user";

    /**
     * Version of this profile
     */
    version: number;
  };
}

/**
 * Built-in execution profiles for common workflow stages
 */
export interface BuiltInExecutionProfile {
  /**
   * ID of the built-in profile
   */
  id: string;

  /**
   * Name of the built-in profile
   */
  name: string;

  /**
   * Description of the built-in profile
   */
  description: string;

  /**
   * Stage types this profile applies to
   */
  applicableStageTypes: string[];

  /**
   * Preferred executor type
   */
  preferredExecutorType: "copilot" | "keystone" | "manual";

  /**
   * Default token budget
   */
  defaultTokenBudget: number;

  /**
   * Default skills included
   */
  defaultSkills: string[];

  /**
   * Expected output contract
   */
  expectedOutputContract: ExecutionProfile["output"];

  /**
   * Approval behavior
   */
  approvalRequired: boolean;

  /**
   * Whether prompt preview is required
   */
  requirePromptPreview: boolean;

  /**
   * Fallback behavior
   */
  fallbackBehavior: {
    fallbackAgentId?: string;
    fallbackMode?: "manual" | "chat-handoff" | "block";
  };
}

/**
 * Built-in execution profiles that are provided by Keystone
 */
export const BUILT_IN_EXECUTION_PROFILES: BuiltInExecutionProfile[] = [
  {
    id: "repository-understanding-profile",
    name: "Repository Understanding",
    description: "Profile for understanding repository structure and patterns",
    applicableStageTypes: ["understanding"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 8000,
    defaultSkills: ["repository-understanding"],
    expectedOutputContract: {
      contractType: "analysis",
      expectedArtifacts: ["repository-map.md", "architecture-diagram.svg"],
      requireStructuredResult: true,
    },
    approvalRequired: false,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "manual",
    },
  },
  {
    id: "implementation-profile",
    name: "Implementation",
    description: "Profile for implementing new features or code changes",
    applicableStageTypes: ["implementation"],
    preferredExecutorType: "copilot",
    defaultTokenBudget: 12000,
    defaultSkills: ["implementation-planning", "bounded-code-modification"],
    expectedOutputContract: {
      contractType: "implementation",
      expectedArtifacts: ["implementation-changes", "test-updates"],
      requireStructuredResult: true,
    },
    approvalRequired: true,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "chat-handoff",
    },
  },
  {
    id: "impact-analysis-profile",
    name: "Impact Analysis",
    description: "Profile for analyzing the impact of code changes",
    applicableStageTypes: ["analysis"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 10000,
    defaultSkills: ["test-impact-analysis"],
    expectedOutputContract: {
      contractType: "analysis",
      expectedArtifacts: ["impact-report.md"],
      requireStructuredResult: true,
    },
    approvalRequired: false,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "manual",
    },
  },
  {
    id: "test-generation-profile",
    name: "Test Generation",
    description: "Profile for generating tests for new or changed code",
    applicableStageTypes: ["testing"],
    preferredExecutorType: "copilot",
    defaultTokenBudget: 10000,
    defaultSkills: ["test-generation"],
    expectedOutputContract: {
      contractType: "test-plan",
      expectedArtifacts: ["test-plan.md", "test-suite"],
      requireStructuredResult: true,
    },
    approvalRequired: true,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "chat-handoff",
    },
  },
  {
    id: "test-failure-analysis-profile",
    name: "Test Failure Analysis",
    description: "Profile for analyzing and understanding test failures",
    applicableStageTypes: ["testing"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 8000,
    defaultSkills: ["failure-classification"],
    expectedOutputContract: {
      contractType: "test-changes",
      expectedArtifacts: ["failure-analysis.md"],
      requireStructuredResult: true,
    },
    approvalRequired: false,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "manual",
    },
  },
  {
    id: "test-healing-profile",
    name: "Test Healing",
    description: "Profile for healing failing tests with minimal impact",
    applicableStageTypes: ["testing"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 8000,
    defaultSkills: ["safe-test-healing"],
    expectedOutputContract: {
      contractType: "test-changes",
      expectedArtifacts: ["healed-tests"],
      requireStructuredResult: true,
    },
    approvalRequired: true,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "chat-handoff",
    },
  },
  {
    id: "security-analysis-profile",
    name: "Security Analysis",
    description: "Profile for performing security code reviews",
    applicableStageTypes: ["review"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 10000,
    defaultSkills: ["security-review"],
    expectedOutputContract: {
      contractType: "review-findings",
      expectedArtifacts: ["security-findings.md"],
      requireStructuredResult: true,
    },
    approvalRequired: true,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "manual",
    },
  },
  {
    id: "performance-analysis-profile",
    name: "Performance Analysis",
    description: "Profile for analyzing code performance characteristics",
    applicableStageTypes: ["review"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 10000,
    defaultSkills: ["performance-review"],
    expectedOutputContract: {
      contractType: "review-findings",
      expectedArtifacts: ["performance-findings.md"],
      requireStructuredResult: true,
    },
    approvalRequired: false,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "manual",
    },
  },
  {
    id: "pr-review-profile",
    name: "PR Review",
    description: "Profile for conducting comprehensive PR reviews",
    applicableStageTypes: ["review"],
    preferredExecutorType: "keystone",
    defaultTokenBudget: 12000,
    defaultSkills: ["pr-review"],
    expectedOutputContract: {
      contractType: "review-findings",
      expectedArtifacts: ["pr-review-report.md"],
      requireStructuredResult: true,
    },
    approvalRequired: true,
    requirePromptPreview: true,
    fallbackBehavior: {
      fallbackAgentId: "keystone-agent",
      fallbackMode: "manual",
    },
  },
];
