/**
 * Service for building prompt packages for Keystone workflow stages.
 *
 * This service creates structured prompt packages that contain all the necessary
 * context, instructions, and task details for delegation to agents.
 */

import type { Capability, InstructionCapability, SkillCapability, AgentCapability } from './capability';
import type { ExecutionProfile } from './executionProfile';
import type { CapabilityDiscoveryService } from './capabilityDiscoveryService';
import type { KeystoneLogger } from '../../shared/logging/KeystoneLogger';
import type { VSCodeAPI } from '../../shared/contracts/vscodeApi';
import { KeystoneError } from '../../shared/errors/KeystoneError';

/**
 * Structure of a prompt package that gets built for delegation
 */
export interface PromptPackage {
  /**
   * Structured internal representation
   */
  structured: {
    workflow?: {
      intent?: string;
      workType?: string;
      currentStage?: string;
      workItemObjective?: string;
    };

    specification?: {
      approvedRequirements?: string[];
      acceptanceCriteria?: string[];
      constraints?: string[];
    };

    repositoryIntelligence?: {
      relevantArchitecture?: string[];
      relevantEntities?: string[];
      relevantFlows?: string[];
      dependencies?: string[];
      impactInformation?: string[];
    };

    context?: {
      selectedSourceEvidence?: string[];
      userPinnedContext?: string[];
      priorRelevantStageOutputs?: string[];
    };

    skills?: {
      selectedSkills: SkillCapability[];
      order: number[];
    };

    instructions?: {
      resolvedInstructions: InstructionCapability[];
      precedenceOrder: string[];
    };

    task?: {
      exactWork: string;
      boundaries: string[];
      allowedFiles: string[];
      excludedFiles: string[];
    };

    expectedOutput?: {
      requiredResultStructure?: string;
      requiredEvidence?: string[];
      validationExpectations?: string[];
    };
  };

  /**
   * Rendered Markdown prompt
   */
  rendered: string;

  /**
   * Estimated token count
   */
  estimatedTokens: number;

  /**
   * Source references for tracking
   */
  sourceReferences: {
    workflowId?: string;
    stageId?: string;
    workItemId?: string;
    profileId?: string;
  };

  /**
   * Content hash for change tracking
   */
  contentHash?: string;

  /**
   * Validation warnings
   */
  validationWarnings?: string[];
}

/**
 * Service for building prompt packages for Keystone workflow stages.
 */
export class PromptPackageBuilder {
  private logger: KeystoneLogger;
  private capabilityService: CapabilityDiscoveryService;
  private vscodeAPI: VSCodeAPI;

  constructor(logger: KeystoneLogger, capabilityService: CapabilityDiscoveryService, vscodeAPI: VSCodeAPI) {
    this.logger = logger;
    this.capabilityService = capabilityService;
    this.vscodeAPI = vscodeAPI;
  }

  /**
   * Build a complete prompt package for delegation.
   *
   * @param workflowId The ID of the workflow
   * @param stageId The ID of the stage being executed
   * @param workItemId The ID of the work item
   * @param profile The execution profile to use
   * @param contextItems Additional context items to include
   * @returns The built prompt package
   */
  async buildPromptPackage(
    workflowId: string,
    stageId: string,
    workItemId: string,
    profile: ExecutionProfile,
    contextItems?: string[]
  ): Promise<PromptPackage> {
    this.logger.info('promptPackageBuilder.buildPromptPackage', `Building prompt package for workflow ${workflowId}, stage ${stageId}`);

    try {
      const packageContent: PromptPackage = {
        structured: {},
        rendered: '',
        estimatedTokens: 0,
        sourceReferences: {
          workflowId,
          stageId,
          workItemId,
          profileId: profile.id
        },
        contentHash: undefined,
        validationWarnings: []
      };

      // Build the structured content components
      packageContent.structured.workflow = this.buildWorkflowSection(profile);
      packageContent.structured.specification = this.buildSpecificationSection(profile);
      packageContent.structured.repositoryIntelligence = this.buildRepositoryIntelligenceSection(profile);
      packageContent.structured.context = this.buildContextSection(profile, contextItems);
      packageContent.structured.skills = this.buildSkillsSection(profile);
      packageContent.structured.instructions = this.buildInstructionsSection(profile);
      packageContent.structured.task = this.buildTaskSection(profile, workflowId, stageId);
      packageContent.structured.expectedOutput = this.buildExpectedOutputSection(profile);

      // Render the Markdown prompt
      packageContent.rendered = this.renderPrompt(packageContent.structured);

      // Estimate token count (this is a simplified implementation)
      packageContent.estimatedTokens = this.estimateTokens(packageContent.rendered);

      // Validate the package
      packageContent.validationWarnings = this.validatePromptPackage(packageContent, profile);

      this.logger.info('promptPackageBuilder.buildPromptPackage', `Successfully built prompt package with ${packageContent.estimatedTokens} estimated tokens`);

      return packageContent;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'promptPackageBuilder.buildPromptPackage'));
      throw new Error(`Failed to build prompt package: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the workflow section of the prompt package.
   *
   * @param profile The execution profile to use
   * @returns The workflow section content
   */
  private buildWorkflowSection(profile: ExecutionProfile): PromptPackage['structured']['workflow'] {
    // In a real implementation, this would pull from actual workflow data
    return {
      intent: "Implementation",
      workType: "Feature Implementation",
      currentStage: "Implementation",
      workItemObjective: "Implement new feature X"
    };
  }

  /**
   * Build the specification section of the prompt package.
   *
   * @param profile The execution profile to use
   * @returns The specification section content
   */
  private buildSpecificationSection(profile: ExecutionProfile): PromptPackage['structured']['specification'] {
    // In a real implementation, this would pull from actual specification data
    return {
      approvedRequirements: ["Requirement 1: Implement feature X", "Requirement 2: Ensure backward compatibility"],
      acceptanceCriteria: ["All tests pass", "Code coverage > 90%", "No regressions in existing features"],
      constraints: ["Do not modify core libraries", "Keep changes minimal"]
    };
  }

  /**
   * Build the repository intelligence section of the prompt package.
   *
   * @param profile The execution profile to use
   * @returns The repository intelligence section content
   */
  private buildRepositoryIntelligenceSection(profile: ExecutionProfile): PromptPackage['structured']['repositoryIntelligence'] {
    // In a real implementation, this would pull from the intelligence graph
    return {
      relevantArchitecture: ["API Layer", "Data Layer", "UI Layer"],
      relevantEntities: ["User", "Order", "Product"],
      relevantFlows: ["User Login", "Order Processing"],
      dependencies: ["Database", "Authentication Service"],
      impactInformation: ["Changes might affect order processing flow"]
    };
  }

  /**
   * Build the context section of the prompt package.
   *
   * @param profile The execution profile to use
   * @param contextItems Additional context items to include
   * @returns The context section content
   */
  private buildContextSection(profile: ExecutionProfile, contextItems?: string[]): PromptPackage['structured']['context'] {
    const context: PromptPackage['structured']['context'] = {
      selectedSourceEvidence: [],
      userPinnedContext: [],
      priorRelevantStageOutputs: []
    };

    // Add user-pinned context if any
    if (contextItems && contextItems.length > 0) {
      context.userPinnedContext = contextItems;
    }

    // Add other context elements (in a real implementation, this would include
    // actual evidence from the intelligence graph or previous stages)
    context.selectedSourceEvidence = [
      "Current implementation context",
      "Recent changes in repository"
    ];

    return context;
  }

  /**
   * Build the skills section of the prompt package.
   *
   * @param profile The execution profile to use
   * @returns The skills section content
   */
  private buildSkillsSection(profile: ExecutionProfile): PromptPackage['structured']['skills'] {
    const skills: SkillCapability[] = [];

    // Get the skill capabilities that are referenced in the profile
    for (const skillRef of profile.skills) {
      const skill = this.capabilityService.getCapabilityById(skillRef.skillId) as SkillCapability | undefined;
      if (skill) {
        skills.push(skill);
      }
    }

    // Order skills by their order in the profile
    const orderedSkills = [...skills].sort((a, b) => {
      const aRef = profile.skills.find(s => s.skillId === a.id);
      const bRef = profile.skills.find(s => s.skillId === b.id);
      return (aRef?.order || 0) - (bRef?.order || 0);
    });

    return {
      selectedSkills: orderedSkills,
      order: profile.skills.map(s => s.order)
    };
  }

  /**
   * Build the instructions section of the prompt package.
   *
   * @param profile The execution profile to use
   * @returns The instructions section content
   */
  private buildInstructionsSection(profile: ExecutionProfile): PromptPackage['structured']['instructions'] {
    const instructions: InstructionCapability[] = [];

    // Get the instruction capabilities that are referenced in the profile
    for (const instructionRef of profile.instructions) {
      const instruction = this.capabilityService.getCapabilityById(instructionRef.instructionId) as InstructionCapability | undefined;
      if (instruction) {
        instructions.push(instruction);
      }
    }

    // Order instructions by their precedence (lower numbers have higher precedence)
    const orderedInstructions = [...instructions].sort((a, b) => {
      return (a.precedence || 0) - (b.precedence || 0);
    });

    // Get the precedence order as strings (this would be used for display)
    const precedenceOrder = orderedInstructions.map(i => i.id);

    return {
      resolvedInstructions: orderedInstructions,
      precedenceOrder
    };
  }

  /**
   * Build the task section of the prompt package.
   *
   * @param profile The execution profile to use
   * @param workflowId The workflow ID
   * @param stageId The stage ID
   * @returns The task section content
   */
  private buildTaskSection(profile: ExecutionProfile, workflowId: string, stageId: string): PromptPackage['structured']['task'] {
    return {
      exactWork: "Implement new feature X according to the specification",
      boundaries: ["Only modify files in the src/ directory", "Do not change external dependencies"],
      allowedFiles: ["src/features/feature-x", "src/models"],
      excludedFiles: ["src/lib", "src/tests"]
    };
  }

  /**
   * Build the expected output section of the prompt package.
   *
   * @param profile The execution profile to use
   * @returns The expected output section content
   */
  private buildExpectedOutputSection(profile: ExecutionProfile): PromptPackage['structured']['expectedOutput'] {
    return {
      requiredResultStructure: profile.output.contractType === "custom"
        ? profile.output.customSchemaId || "custom"
        : profile.output.contractType,
      requiredEvidence: profile.output.expectedArtifacts,
      validationExpectations: [
        "Changes must pass all existing tests",
        "Code must follow the repository's coding standards",
        "New functionality must be properly documented"
      ]
    };
  }

  /**
   * Render the prompt package as Markdown.
   *
   * @param structuredContent The structured content to render
   * @returns The rendered Markdown string
   */
  private renderPrompt(structuredContent: PromptPackage['structured']): string {
    let rendered = '';

    // Add Keystone Execution Contract section
    rendered += '# Keystone Execution Contract\n\n';

    // Add Workflow section
    if (structuredContent.workflow) {
      rendered += '## Workflow\n';
      rendered += `- Intent: ${structuredContent.workflow.intent}\n`;
      rendered += `- Work type: ${structuredContent.workflow.workType}\n`;
      rendered += `- Current stage: ${structuredContent.workflow.currentStage}\n`;
      rendered += `- Work-item objective: ${structuredContent.workflow.workItemObjective}\n\n`;
    }

    // Add Specification section
    if (structuredContent.specification) {
      rendered += '## Specification\n';
      rendered += '- Approved requirements:\n';
      if (structuredContent.specification.approvedRequirements) {
        for (const req of structuredContent.specification.approvedRequirements) {
          rendered += `  - ${req}\n`;
        }
      }
      rendered += '- Acceptance criteria:\n';
      if (structuredContent.specification.acceptanceCriteria) {
        for (const criteria of structuredContent.specification.acceptanceCriteria) {
          rendered += `  - ${criteria}\n`;
        }
      }
      rendered += '- Constraints:\n';
      if (structuredContent.specification.constraints) {
        for (const constraint of structuredContent.specification.constraints) {
          rendered += `  - ${constraint}\n`;
        }
      }
      rendered += '\n';
    }

    // Add Repository Intelligence section
    if (structuredContent.repositoryIntelligence) {
      rendered += '## Repository Intelligence\n';
      rendered += '- Relevant architecture:\n';
      if (structuredContent.repositoryIntelligence.relevantArchitecture) {
        for (const arch of structuredContent.repositoryIntelligence.relevantArchitecture) {
          rendered += `  - ${arch}\n`;
        }
      }
      rendered += '- Relevant entities:\n';
      if (structuredContent.repositoryIntelligence.relevantEntities) {
        for (const entity of structuredContent.repositoryIntelligence.relevantEntities) {
          rendered += `  - ${entity}\n`;
        }
      }
      rendered += '- Relevant flows:\n';
      if (structuredContent.repositoryIntelligence.relevantFlows) {
        for (const flow of structuredContent.repositoryIntelligence.relevantFlows) {
          rendered += `  - ${flow}\n`;
        }
      }
      rendered += '\n';
    }

    // Add Context section
    if (structuredContent.context) {
      rendered += '## Context\n';
      rendered += '- Selected source evidence:\n';
      if (structuredContent.context.selectedSourceEvidence) {
        for (const evidence of structuredContent.context.selectedSourceEvidence) {
          rendered += `  - ${evidence}\n`;
        }
      }
      rendered += '- User-pinned context:\n';
      if (structuredContent.context.userPinnedContext) {
        for (const context of structuredContent.context.userPinnedContext) {
          rendered += `  - ${context}\n`;
        }
      }
      rendered += '\n';
    }

    // Add Skills section
    if (structuredContent.skills) {
      rendered += '## Skills\n';
      if (structuredContent.skills.selectedSkills && structuredContent.skills.selectedSkills.length > 0) {
        for (const skill of structuredContent.skills.selectedSkills) {
          rendered += `- ${skill.name}\n`;
        }
      } else {
        rendered += '- None selected\n';
      }
      rendered += '\n';
    }

    // Add Instructions section
    if (structuredContent.instructions) {
      rendered += '## Instructions\n';
      if (structuredContent.instructions.resolvedInstructions && structuredContent.instructions.resolvedInstructions.length > 0) {
        for (const instruction of structuredContent.instructions.resolvedInstructions) {
          rendered += `- ${instruction.name}\n`;
        }
      } else {
        rendered += '- None selected\n';
      }
      rendered += '\n';
    }

    // Add Task section
    if (structuredContent.task) {
      rendered += '## Task\n';
      rendered += `- Exact work to perform: ${structuredContent.task.exactWork}\n`;
      rendered += '- Boundaries:\n';
      if (structuredContent.task.boundaries) {
        for (const boundary of structuredContent.task.boundaries) {
          rendered += `  - ${boundary}\n`;
        }
      }
      rendered += '- Files or scopes allowed:\n';
      if (structuredContent.task.allowedFiles) {
        for (const file of structuredContent.task.allowedFiles) {
          rendered += `  - ${file}\n`;
        }
      }
      rendered += '- Files or scopes excluded:\n';
      if (structuredContent.task.excludedFiles) {
        for (const file of structuredContent.task.excludedFiles) {
          rendered += `  - ${file}\n`;
        }
      }
      rendered += '\n';
    }

    // Add Expected Output section
    if (structuredContent.expectedOutput) {
      rendered += '## Expected Output\n';
      rendered += `- Required result structure: ${structuredContent.expectedOutput.requiredResultStructure}\n`;
      rendered += '- Required evidence:\n';
      if (structuredContent.expectedOutput.requiredEvidence) {
        for (const evidence of structuredContent.expectedOutput.requiredEvidence) {
          rendered += `  - ${evidence}\n`;
        }
      }
      rendered += '- Validation expectations:\n';
      if (structuredContent.expectedOutput.validationExpectations) {
        for (const expectation of structuredContent.expectedOutput.validationExpectations) {
          rendered += `  - ${expectation}\n`;
        }
      }
      rendered += '\n';
    }

    return rendered;
  }

  /**
   * Estimate token count for the rendered prompt.
   *
   * @param renderedPrompt The rendered prompt string
   * @returns Estimated token count (simplified implementation)
   */
  private estimateTokens(renderedPrompt: string): number {
    // This is a rough estimate - in reality, we'd use a proper tokenization library
    // For this implementation, we'll use a simple approximation based on character length
    return Math.ceil(renderedPrompt.length / 4); // Rough approximation - 1 token ~ 4 characters
  }

  /**
   * Validate the built prompt package.
   *
   * @param packageContent The built package to validate
   * @param profile The execution profile used for building
   * @returns List of validation warnings
   */
  private validatePromptPackage(
    packageContent: PromptPackage,
    profile: ExecutionProfile
  ): string[] {
    const warnings: string[] = [];

    // Check that all required fields are present
    if (!packageContent.structured.workflow) {
      warnings.push('Missing workflow information');
    }

    if (!packageContent.structured.specification) {
      warnings.push('Missing specification information');
    }

    if (!packageContent.structured.task) {
      warnings.push('Missing task information');
    }

    // Check that the profile's token budget is reasonable
    if (packageContent.estimatedTokens > profile.context.tokenBudget) {
      warnings.push(`Estimated tokens (${packageContent.estimatedTokens}) exceeds token budget (${profile.context.tokenBudget})`);
    }

    // Check that the selected agent is available
    const agent = this.capabilityService.getCapabilityById(profile.executor.agentId);
    if (!agent) {
      warnings.push(`Selected agent ${profile.executor.agentId} is not available`);
    } else if (agent.state !== 'available') {
      warnings.push(`Selected agent ${profile.executor.agentId} is not in available state`);
    }

    // Check that all referenced skills exist (this is a simplified check)
    for (const skillRef of profile.skills) {
      const skill = this.capabilityService.getCapabilityById(skillRef.skillId);
      if (!skill) {
        warnings.push(`Selected skill ${skillRef.skillId} is not available`);
      }
    }

    // Check that all referenced instructions exist (this is a simplified check)
    for (const instructionRef of profile.instructions) {
      const instruction = this.capabilityService.getCapabilityById(instructionRef.instructionId);
      if (!instruction) {
        warnings.push(`Selected instruction ${instructionRef.instructionId} is not available`);
      }
    }

    return warnings;
  }
}