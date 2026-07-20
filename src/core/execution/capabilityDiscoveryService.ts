/**
 * Service for discovering execution capabilities in the VS Code environment.
 *
 * This service identifies which execution resources are available in the current
 * VS Code environment, including agents, skills, instructions, and language model providers.
 */

import type { Capability, CapabilityDiscoveryResult, CapabilityState, AgentCapability, SkillCapability, InstructionCapability, CapabilityType, ExtensionContributionCapability, LanguageModelProviderCapability, CommandCapability, PromptCapability } from './capability';
import type { KeystoneLogger } from '../../shared/logging/KeystoneLogger';
import type { VSCodeAPI } from '../../shared/contracts/vscodeApi';
import { KeystoneError } from '../../shared/errors/KeystoneError';

/**
 * Service that discovers available execution capabilities in the VS Code environment.
 */
export class CapabilityDiscoveryService {
  private logger: KeystoneLogger;
  private vscodeAPI: VSCodeAPI;
  private capabilities: Capability[] = [];
  private lastDiscoveryTimestamp: string = new Date().toISOString();

  constructor(logger: KeystoneLogger, vscodeAPI: VSCodeAPI) {
    this.logger = logger;
    this.vscodeAPI = vscodeAPI;
  }

  /**
   * Discover all available capabilities in the current VS Code environment.
   *
   * @returns Promise resolving to capability discovery results
   */
  discoverCapabilities(): CapabilityDiscoveryResult {
    this.logger.info('capabilityDiscoveryService.discoverCapabilities', 'Starting capability discovery process');

    try {
      const capabilities: Capability[] = [];

      // Discover agents
      const agentCapabilities = this.discoverAgents();
      capabilities.push(...agentCapabilities);

      // Discover skills
      const skillCapabilities = this.discoverSkills();
      capabilities.push(...skillCapabilities);

      // Discover instructions
      const instructionCapabilities = this.discoverInstructions();
      capabilities.push(...instructionCapabilities);

      // Discover language model providers
      const languageModelCapabilities = this.discoverLanguageModelProviders();
      capabilities.push(...languageModelCapabilities);

      // Discover commands
      const commandCapabilities = this.discoverCommands();
      capabilities.push(...commandCapabilities);

      // Discover prompts
      const promptCapabilities = this.discoverPrompts();
      capabilities.push(...promptCapabilities);

      // Discover extension contributions
      const extensionContributionCapabilities = this.discoverExtensionContributions();
      capabilities.push(...extensionContributionCapabilities);

      this.capabilities = capabilities;
      this.lastDiscoveryTimestamp = new Date().toISOString();

      this.logger.info('capabilityDiscoveryService.discoverCapabilities', `Discovered ${capabilities.length} capabilities`);

      return {
        capabilities,
        timestamp: this.lastDiscoveryTimestamp,
        errors: []
      };
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverCapabilities'));
      return {
        capabilities: [],
        timestamp: this.lastDiscoveryTimestamp,
        errors: [error instanceof Error ? error.message : 'Unknown error during capability discovery']
      };
    }
  }

  /**
   * Discover available agents in the VS Code environment.
   *
   * @returns Promise resolving to list of agent capabilities
   */
  private discoverAgents(): AgentCapability[] {
    const agents: AgentCapability[] = [];

    try {
      // Check if VS Code chat participants are available
      const chatParticipants = await this.vscodeAPI.getChatParticipants();
      this.logger.debug('capabilityDiscoveryService.discoverAgents', `Found ${chatParticipants.length} chat participants`);

      for (const participant of chatParticipants) {
        const agent: AgentCapability = {
          id: `chat-participant-${participant.id}`,
          name: participant.name,
          type: 'agent',
          source: 'vscode-chat-participant',
          description: participant.description,
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          supportsDirectInvocation: false,
          supportsManualHandoff: false,
          supportedStageTypes: ['implementation', 'analysis', 'testing', 'review'],
          invocationModes: ['manual']
        };

        agents.push(agent);
      }

      // Check for Copilot agents
      const copilotAgent: AgentCapability = {
        id: 'copilot-agent',
        name: 'GitHub Copilot Agent',
        type: 'agent',
        source: 'github-copilot',
        description: 'GitHub Copilot agent for code completion and assistance',
        state: 'partially-available',
        lastDiscovered: this.lastDiscoveryTimestamp,
        supportsDirectInvocation: false,
        supportsManualHandoff: true,
        supportedStageTypes: ['implementation', 'analysis', 'testing', 'review'],
        invocationModes: ['chat-handoff', 'clipboard-handoff', 'manual']
      };

      agents.push(copilotAgent);

      // Check for built-in Keystone agents
      const keystoneAgent: AgentCapability = {
        id: 'keystone-agent',
        name: 'Keystone Agent',
        type: 'agent',
        source: 'keystone-built-in',
        description: 'Keystone internal deterministic operation agent',
        state: 'available',
        lastDiscovered: this.lastDiscoveryTimestamp,
        supportsDirectInvocation: true,
        supportsManualHandoff: true,
        supportedStageTypes: ['implementation', 'analysis', 'testing', 'review', 'validation'],
        invocationModes: ['direct', 'manual', 'deterministic']
      };

      agents.push(keystoneAgent);

      this.logger.debug('capabilityDiscoveryService.discoverAgents', `Discovered ${agents.length} agents`);

      return agents;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverAgents'));
      return [];
    }
  }

  /**
   * Discover available skills in the system.
   *
   * @returns Promise resolving to list of skill capabilities
   */
  private discoverSkills(): SkillCapability[] {
    const skills: SkillCapability[] = [];

    try {
      // Built-in Keystone skills
      const keystoneSkills: SkillCapability[] = [
        {
          id: 'repository-understanding',
          name: 'Repository Understanding',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for understanding repository structure and patterns',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['understanding', 'analysis'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['repository-instructions.md'],
          version: '1.0.0'
        },
        {
          id: 'implementation-planning',
          name: 'Implementation Planning',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for planning code implementations',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['implementation'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['coding-guidelines.md'],
          version: '1.0.0'
        },
        {
          id: 'bounded-code-modification',
          name: 'Bounded Code Modification',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for making specific code changes within constraints',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['implementation'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['change-constraints.md'],
          version: '1.0.0'
        },
        {
          id: 'test-impact-analysis',
          name: 'Test Impact Analysis',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for analyzing impact of code changes on tests',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['testing', 'analysis'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['test-guidelines.md'],
          version: '1.0.0'
        },
        {
          id: 'test-generation',
          name: 'Test Generation',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for generating new tests for code changes',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['testing'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['test-generation.md'],
          version: '1.0.0'
        },
        {
          id: 'failure-classification',
          name: 'Failure Classification',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for categorizing and classifying test failures',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['testing'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['failure-analysis.md'],
          version: '1.0.0'
        },
        {
          id: 'safe-test-healing',
          name: 'Safe Test Healing',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for healing failing tests with minimal impact',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['testing'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['test-healing.md'],
          version: '1.0.0'
        },
        {
          id: 'security-review',
          name: 'Security Review',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for performing security code reviews',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['review'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['security-guidelines.md'],
          version: '1.0.0'
        },
        {
          id: 'performance-review',
          name: 'Performance Review',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for analyzing code performance characteristics',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['review'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['performance-guidelines.md'],
          version: '1.0.0'
        },
        {
          id: 'pr-review',
          name: 'PR Review',
          type: 'skill',
          source: 'keystone-built-in',
          description: 'Skill for conducting comprehensive PR reviews',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          applicableStageTypes: ['review'],
          requiredCapabilities: ['language-model-provider'],
          instructionReferences: ['pr-review-guidelines.md'],
          version: '1.0.0'
        }
      ];

      skills.push(...keystoneSkills);

      this.logger.debug('capabilityDiscoveryService.discoverSkills', `Discovered ${skills.length} skills`);

      return skills;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverSkills'));
      return [];
    }
  }

  /**
   * Discover instruction files in the repository and workspace.
   *
   * @returns Promise resolving to list of instruction capabilities
   */
  private discoverInstructions(): InstructionCapability[] {
    const instructions: InstructionCapability[] = [];

    try {
      // Discover repository instruction files
      const repoInstructions = this.discoverRepositoryInstructions();
      instructions.push(...repoInstructions);

      // Discover workspace instruction files
      const workspaceInstructions = this.discoverWorkspaceInstructions();
      instructions.push(...workspaceInstructions);

      // Discover user instruction files
      const userInstructions = this.discoverUserInstructions();
      instructions.push(...userInstructions);

      // Discover system instructions
      const systemInstructions = this.discoverSystemInstructions();
      instructions.push(...systemInstructions);

      this.logger.debug('capabilityDiscoveryService.discoverInstructions', `Discovered ${instructions.length} instructions`);

      return instructions;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverInstructions'));
      return [];
    }
  }

  /**
   * Discover repository instruction files.
   *
   * @returns Promise resolving to list of repository instruction capabilities
   */
  private discoverRepositoryInstructions(): InstructionCapability[] {
    const instructions: InstructionCapability[] = [];

    try {
      // Look for common instruction file patterns in the repository
      const instructionFiles = [
        'repository-instructions.md',
        'coding-guidelines.md',
        'change-constraints.md',
        'test-guidelines.md',
        'security-guidelines.md',
        'performance-guidelines.md',
        'pr-review-guidelines.md'
      ];

      for (const filename of instructionFiles) {
        // For now, we'll create placeholders - actual file checking would require filesystem access
        const instruction: InstructionCapability = {
          id: `repo-${filename.replace('.', '-')}`,
          name: filename,
          type: 'instruction',
          source: 'repository',
          description: `Repository instruction file: ${filename}`,
          state: 'partially-available', // We don't know if file exists yet
          lastDiscovered: this.lastDiscoveryTimestamp,
          filePath: filename,
          scope: 'repository',
          precedence: 5, // Lower numbers have higher precedence
          enabled: true,
          contentHash: undefined
        };

        instructions.push(instruction);
      }

      return instructions;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverRepositoryInstructions'));
      return [];
    }
  }

  /**
   * Discover workspace instruction files.
   *
   * @returns Promise resolving to list of workspace instruction capabilities
   */
  private discoverWorkspaceInstructions(): InstructionCapability[] {
    const instructions: InstructionCapability[] = [];

    try {
      // Look for workspace-specific instruction files
      const workspaceInstructionFiles = [
        '.vscode/workspace-instructions.md',
        '.keystone/workspace-instructions.md'
      ];

      for (const filename of workspaceInstructionFiles) {
        const instruction: InstructionCapability = {
          id: `workspace-${filename.replace('.', '-')}`,
          name: filename,
          type: 'instruction',
          source: 'workspace',
          description: `Workspace instruction file: ${filename}`,
          state: 'partially-available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          filePath: filename,
          scope: 'workspace',
          precedence: 6,
          enabled: true,
          contentHash: undefined
        };

        instructions.push(instruction);
      }

      return instructions;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverWorkspaceInstructions'));
      return [];
    }
  }

  /**
   * Discover user instruction files.
   *
   * @returns Promise resolving to list of user instruction capabilities
   */
  private discoverUserInstructions(): InstructionCapability[] {
    const instructions: InstructionCapability[] = [];

    try {
      // Look for user-selected instruction files
      const userInstructionFiles = [
        '.keystone/user-instructions.md',
        'custom-instructions.md'
      ];

      for (const filename of userInstructionFiles) {
        const instruction: InstructionCapability = {
          id: `user-${filename.replace('.', '-')}`,
          name: filename,
          type: 'instruction',
          source: 'user',
          description: `User instruction file: ${filename}`,
          state: 'partially-available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          filePath: filename,
          scope: 'user',
          precedence: 7,
          enabled: true,
          contentHash: undefined
        };

        instructions.push(instruction);
      }

      return instructions;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverUserInstructions'));
      return [];
    }
  }

  /**
   * Discover system instruction files.
   *
   * @returns Promise resolving to list of system instruction capabilities
   */
  private discoverSystemInstructions(): InstructionCapability[] {
    const instructions: InstructionCapability[] = [];

    try {
      // System or built-in instructions that are always available
      const systemInstructions: InstructionCapability[] = [
        {
          id: 'keystone-safety',
          name: 'Keystone Safety Instructions',
          type: 'instruction' as const,
          source: 'keystone-system',
          description: 'Keystone safety and execution contract instructions',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          filePath: undefined,
          scope: 'system',
          precedence: 1, // Highest precedence
          enabled: true,
          contentHash: 'safety-1.0.0'
        },
        {
          id: 'output-contract',
          name: 'Output Contract Instructions',
          type: 'instruction' as const,
          source: 'keystone-system',
          description: 'Instructions about expected output formats',
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          filePath: undefined,
          scope: 'system',
          precedence: 2, // Second highest precedence
          enabled: true,
          contentHash: 'output-1.0.0'
        }
      ];

      instructions.push(...systemInstructions);

      return instructions;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverSystemInstructions'));
      return [];
    }
  }

  /**
   * Discover language model providers.
   *
   * @returns Promise resolving to list of language model provider capabilities
   */
  private discoverLanguageModelProviders(): LanguageModelProviderCapability[] {
    const providers: LanguageModelProviderCapability[] = [];

    try {
      // Check for available language model providers
      const lmProviders = await this.vscodeAPI.getLanguageModelProviders();

      for (const provider of lmProviders) {
        const lmProvider: LanguageModelProviderCapability = {
          id: `lm-provider-${provider.id}`,
          name: provider.name,
          type: 'languageModelProvider',
          source: 'vscode-language-model',
          description: `Language model provider: ${provider.name}`,
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          providerName: provider.name,
          supportedModels: provider.models,
          supportsDirectInvocation: true
        };

        providers.push(lmProvider);
      }

      // Add built-in Keystone provider (for internal operations)
      const keystoneProvider: LanguageModelProviderCapability = {
        id: 'keystone-built-in-provider',
        name: 'Keystone Built-in Provider',
        type: 'languageModelProvider',
        source: 'keystone-built-in',
        description: 'Keystone internal language model provider',
        state: 'available',
        lastDiscovered: this.lastDiscoveryTimestamp,
        providerName: 'keystone-builtin',
        supportedModels: ['keystone-deterministic'],
        supportsDirectInvocation: true
      };

      providers.push(keystoneProvider);

      this.logger.debug('capabilityDiscoveryService.discoverLanguageModelProviders', `Discovered ${providers.length} language model providers`);

      return providers;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverLanguageModelProviders'));
      return [];
    }
  }

  /**
   * Discover available commands.
   *
   * @returns Promise resolving to list of command capabilities
   */
  private discoverCommands(): CommandCapability[] {
    const commands: CommandCapability[] = [];

    try {
      // Get available commands from VS Code
      const availableCommands = await this.vscodeAPI.getCommands();

      // Filter for Keystone-related commands
      const keystoneCommands = availableCommands.filter((cmd: string) =>
        cmd.startsWith('keystone.') || cmd.startsWith('copilot.')
      );

      for (const command of keystoneCommands) {
        const cmd: CommandCapability = {
          id: `command-${command.replace('.', '-')}`,
          name: command,
          type: 'command',
          source: 'vscode-commands',
          description: `VS Code command: ${command}`,
          state: 'available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          commandName: command,
          available: true
        };

        commands.push(cmd);
      }

      this.logger.debug('capabilityDiscoveryService.discoverCommands', `Discovered ${commands.length} commands`);

      return commands;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverCommands'));
      return [];
    }
  }

  /**
   * Discover available prompt files.
   *
   * @returns Promise resolving to list of prompt capabilities
   */
  private discoverPrompts(): PromptCapability[] {
    const prompts: PromptCapability[] = [];

    try {
      // Look for prompt files in the repository or workspace
      const promptFiles = [
        '.keystone/prompts/implementation.md',
        '.keystone/prompts/analysis.md',
        '.keystone/prompts/testing.md'
      ];

      for (const filename of promptFiles) {
        const prompt: PromptCapability = {
          id: `prompt-${filename.replace('.', '-')}`,
          name: filename,
          type: 'prompt',
          source: 'keystone-prompts',
          description: `Prompt file: ${filename}`,
          state: 'partially-available',
          lastDiscovered: this.lastDiscoveryTimestamp,
          promptPath: filename,
          expectedOutputFormat: 'structured-output',
          content: undefined
        };

        prompts.push(prompt);
      }

      this.logger.debug('capabilityDiscoveryService.discoverPrompts', `Discovered ${prompts.length} prompts`);

      return prompts;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverPrompts'));
      return [];
    }
  }

  /**
   * Discover extension contributions.
   *
   * @returns Promise resolving to list of extension contribution capabilities
   */
  private discoverExtensionContributions(): ExtensionContributionCapability[] {
    const contributions: ExtensionContributionCapability[] = [];

    try {
      // Get available extensions and their contributions
      const extensions = await this.vscodeAPI.getExtensions();

      for (const extension of extensions) {
        if (extension.contributes?.chatParticipants) {
          const contribution: ExtensionContributionCapability = {
            id: `extension-${extension.id}-chat-participant`,
            name: `${extension.name} Chat Participant`,
            type: 'extensionContribution',
            source: extension.id,
            description: `Chat participant from extension: ${extension.name}`,
            state: 'available',
            lastDiscovered: this.lastDiscoveryTimestamp,
            extensionId: extension.id,
            contributionType: 'agent'
          };

          contributions.push(contribution);
        }

        if (extension.contributes?.languageModelTools) {
          const contribution: ExtensionContributionCapability = {
            id: `extension-${extension.id}-lm-tool`,
            name: `${extension.name} Language Model Tool`,
            type: 'extensionContribution',
            source: extension.id,
            description: `Language model tool from extension: ${extension.name}`,
            state: 'available',
            lastDiscovered: this.lastDiscoveryTimestamp,
            extensionId: extension.id,
            contributionType: 'languageModelProvider'
          };

          contributions.push(contribution);
        }
      }

      this.logger.debug('capabilityDiscoveryService.discoverExtensionContributions', `Discovered ${contributions.length} extension contributions`);

      return contributions;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, 'capabilityDiscoveryService.discoverExtensionContributions'));
      return [];
    }
  }

  /**
   * Get all discovered capabilities.
   *
   * @returns List of all discovered capabilities
   */
  getCapabilities(): Capability[] {
    return this.capabilities;
  }

  /**
   * Get capabilities by type.
   *
   * @param type The capability type to filter by
   * @returns List of capabilities matching the type
   */
  getCapabilitiesByType(type: CapabilityType): Capability[] {
    return this.capabilities.filter(cap => cap.type === type);
  }

  /**
   * Get a specific capability by ID.
   *
   * @param id The capability ID to find
   * @returns The capability if found, otherwise undefined
   */
  getCapabilityById(id: string): Capability | undefined {
    return this.capabilities.find(cap => cap.id === id);
  }

  /**
   * Update capability availability state.
   *
   * @param id The capability ID to update
   * @param state The new state to set
   */
  updateCapabilityState(id: string, state: CapabilityState): void {
    const capability = this.getCapabilityById(id);
    if (capability) {
      capability.state = state;
      capability.lastDiscovered = new Date().toISOString();
    }
  }

  /**
   * Validate that a capability is available.
   *
   * @param id The capability ID to validate
   * @returns Whether the capability is available
   */
  isCapabilityAvailable(id: string): boolean {
    const capability = this.getCapabilityById(id);
    return capability?.state === 'available' || capability?.state === 'partially-available';
  }
}