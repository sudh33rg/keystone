/**
 * Service for detecting conflicts between instruction sets.
 *
 * This service identifies potential conflicts between instructions that might
 * contradict each other or lead to problematic execution scenarios.
 */

import type { InstructionCapability } from './capability';
import type { ExecutionProfile } from './executionProfile';
import type { KeystoneLogger } from '../../shared/logging/KeystoneLogger';

/**
 * Instruction conflict detection result
 */
export interface InstructionConflict {
  /**
   * Unique identifier for this conflict
   */
  id: string;

  /**
   * Human-readable description of the conflict
   */
  description: string;

  /**
   * Severity of the conflict (low, medium, high)
   */
  severity: 'low' | 'medium' | 'high';

  /**
   * The instructions involved in the conflict
   */
  conflictingInstructions: InstructionCapability[];

  /**
   * The type of conflict (e.g., contradictory, incompatible)
   */
  conflictType: 'contradictory' | 'incompatible' | 'ambiguous';

  /**
   * Whether this conflict blocks execution
   */
  blocking: boolean;

  /**
   * Suggested resolution for the conflict
   */
  suggestedResolution: string;
}

/**
 * Service for detecting conflicts between instruction sets in Keystone.
 */
export class InstructionConflictDetector {
  private logger: KeystoneLogger;

  constructor(logger: KeystoneLogger) {
    this.logger = logger;
  }

  /**
   * Detect conflicts in the set of instructions for a profile.
   *
   * @param instructions The instructions to analyze for conflicts
   * @returns List of detected conflicts
   */
  detectConflicts(instructions: InstructionCapability[]): InstructionConflict[] {
    const conflicts: InstructionConflict[] = [];

    this.logger.info('instructionConflictDetector.detectConflicts', `Detecting conflicts in ${instructions.length} instructions`);

    // Check for contradictory instructions
    const contradictoryConflicts = this.detectContradictoryInstructions(instructions);
    conflicts.push(...contradictoryConflicts);

    // Check for incompatible instructions
    const incompatibleConflicts = this.detectIncompatibleInstructions(instructions);
    conflicts.push(...incompatibleConflicts);

    // Check for ambiguous instructions
    const ambiguousConflicts = this.detectAmbiguousInstructions(instructions);
    conflicts.push(...ambiguousConflicts);

    this.logger.info('instructionConflictDetector.detectConflicts', `Detected ${conflicts.length} instruction conflicts`);

    return conflicts;
  }

  /**
   * Detect contradictory instruction pairs.
   *
   * @param instructions The instructions to analyze
   * @returns List of contradictory conflicts
   */
  private detectContradictoryInstructions(instructions: InstructionCapability[]): InstructionConflict[] {
    const conflicts: InstructionConflict[] = [];

    // Example: instructions that prohibit and require the same action
    const instructionPairs = [
      {
        name: 'test-modification-allowed',
        description: 'Allow modification of test files',
        conflictingWith: 'test-modification-prohibited',
        conflictDescription: 'Test file modification is both allowed and prohibited'
      },
      {
        name: 'framework-change-allowed',
        description: 'Allow changing frameworks',
        conflictingWith: 'framework-change-prohibited',
        conflictDescription: 'Framework changes are both allowed and prohibited'
      },
      {
        name: 'automatic-commits-allowed',
        description: 'Allow automatic commits',
        conflictingWith: 'automatic-commits-prohibited',
        conflictDescription: 'Automatic commits are both allowed and prohibited'
      }
    ];

    // In a real implementation, we would analyze the actual content of instructions
    // For now, we'll simulate some conflicts based on instruction IDs

    // Simulate checking for specific instruction patterns
    const testModificationAllowed = instructions.find(i =>
      i.name.toLowerCase().includes('test') &&
      i.name.toLowerCase().includes('allow')
    );

    const testModificationProhibited = instructions.find(i =>
      i.name.toLowerCase().includes('test') &&
      i.name.toLowerCase().includes('prohibit')
    );

    if (testModificationAllowed && testModificationProhibited) {
      conflicts.push({
        id: `conflict-test-modification-${Date.now()}`,
        description: 'Conflicting test file modification policies',
        severity: 'high',
        conflictingInstructions: [testModificationAllowed, testModificationProhibited],
        conflictType: 'contradictory',
        blocking: true,
        suggestedResolution: 'Select one policy and remove the conflicting instruction'
      });
    }

    return conflicts;
  }

  /**
   * Detect incompatible instruction pairs.
   *
   * @param instructions The instructions to analyze
   * @returns List of incompatible conflicts
   */
  private detectIncompatibleInstructions(instructions: InstructionCapability[]): InstructionConflict[] {
    const conflicts: InstructionConflict[] = [];

    // Example: instructions that require incompatible approaches
    const incompatiblePairs = [
      {
        name: 'bounded-modification',
        description: 'Require bounded code modifications',
        incompatibleWith: 'unbounded-refactoring',
        conflictDescription: 'Bounded modifications conflict with unbounded refactoring'
      },
      {
        name: 'strict-security',
        description: 'Enforce strict security requirements',
        incompatibleWith: 'lenient-security',
        conflictDescription: 'Strict security is incompatible with lenient security'
      }
    ];

    // Simulate checking for incompatible instruction patterns
    const boundedModification = instructions.find(i =>
      i.name.toLowerCase().includes('bounded') || i.name.toLowerCase().includes('limited')
    );

    const unboundedRefactoring = instructions.find(i =>
      i.name.toLowerCase().includes('unbounded') ||
      i.name.toLowerCase().includes('refactor') ||
      i.name.toLowerCase().includes('complete')
    );

    if (boundedModification && unboundedRefactoring) {
      conflicts.push({
        id: `conflict-bounded-refactor-${Date.now()}`,
        description: 'Incompatible modification approaches',
        severity: 'high',
        conflictingInstructions: [boundedModification, unboundedRefactoring],
        conflictType: 'incompatible',
        blocking: true,
        suggestedResolution: 'Select either bounded or unbounded approach, not both'
      });
    }

    return conflicts;
  }

  /**
   * Detect ambiguous instruction pairs.
   *
   * @param instructions The instructions to analyze
   * @returns List of ambiguous conflicts
   */
  private detectAmbiguousInstructions(instructions: InstructionCapability[]): InstructionConflict[] {
    const conflicts: InstructionConflict[] = [];

    // Example: instructions that are ambiguous or unclear
    const ambiguousInstructions = instructions.filter(i => {
      // Simulate checking for ambiguous instruction names
      const ambiguousKeywords = ['unclear', 'ambiguous', 'vague', 'undefined'];
      return ambiguousKeywords.some(keyword =>
        i.name.toLowerCase().includes(keyword)
      );
    });

    // If any ambiguous instructions are found, report them
    if (ambiguousInstructions.length > 0) {
      conflicts.push({
        id: `conflict-ambiguous-${Date.now()}`,
        description: 'Ambiguous instruction found',
        severity: 'medium',
        conflictingInstructions: ambiguousInstructions,
        conflictType: 'ambiguous',
        blocking: false,
        suggestedResolution: 'Clarify the instruction content or replace with a more specific one'
      });
    }

    return conflicts;
  }

  /**
   * Validate a specific execution profile for instruction conflicts.
   *
   * @param profile The profile to validate
   * @returns List of instruction conflicts found in the profile
   */
  validateProfile(profile: ExecutionProfile): InstructionConflict[] {
    // Collect all instructions from the profile
    const instructions: InstructionCapability[] = [];

    // Get the instruction capabilities referenced in the profile
    for (const instructionRef of profile.instructions) {
      const instruction = this.getInstructionById(instructionRef.instructionId);
      if (instruction) {
        instructions.push(instruction);
      }
    }

    // Detect conflicts in these instructions
    return this.detectConflicts(instructions);
  }

  /**
   * Get an instruction capability by ID.
   *
   * In a real implementation, this would look up the instruction in the capability registry.
   *
   * @param id The instruction ID to look up
   * @returns The instruction capability or undefined if not found
   */
  private getInstructionById(id: string): InstructionCapability | undefined {
    // This is a simplified implementation - in reality, this would be fetched from the capability registry
    // For now, we'll return a mock instruction for demonstration
    return {
      id,
      name: `Instruction-${id}`,
      type: 'instruction',
      source: 'mock-source',
      description: `Mock instruction for ID ${id}`,
      state: 'available',
      lastDiscovered: new Date().toISOString(),
      filePath: undefined,
      scope: 'user',
      precedence: 5,
      enabled: true,
      contentHash: undefined
    };
  }
}