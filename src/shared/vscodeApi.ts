/**
 * VSCode API wrapper for Keystone.
 *
 * This file provides a mock implementation of the VSCodeAPI for testing and
 * serves as a contract for how Keystone will interact with VS Code APIs.
 */

import type { VSCodeAPI } from './contracts/vscodeApi';
import type {
  VSCodeChatParticipant,
  VSCodeLanguageModelProvider,
  VSCodeExtension
} from './contracts/vscodeApi';

/**
 * Mock implementation of VSCodeAPI for testing
 */
export class MockVSCodeAPI implements VSCodeAPI {
  getChatParticipants(): Promise<VSCodeChatParticipant[]> {
    return Promise.resolve([
      {
        id: 'keystone-chat-participant',
        name: 'Keystone',
        description: 'Keystone chat participant for workflow execution'
      }
    ]);
  }

  getLanguageModelProviders(): Promise<VSCodeLanguageModelProvider[]> {
    return Promise.resolve([
      {
        id: 'mock-lm-provider',
        name: 'Mock Language Model Provider',
        models: ['gpt-4', 'claude-3']
      }
    ]);
  }

  getCommands(): Promise<string[]> {
    return Promise.resolve([
      'keystone.startWorkflow',
      'keystone.resumeWorkflow',
      'keystone.open',
      'copilot.generate'
    ]);
  }

  getExtensions(): Promise<VSCodeExtension[]> {
    return Promise.resolve([
      {
        id: 'github.copilot',
        name: 'GitHub Copilot',
        contributes: {
          chatParticipants: [
            {
              id: 'copilot-chat',
              name: 'Copilot',
              description: 'GitHub Copilot chat participant'
            }
          ]
        }
      }
    ]);
  }

  openChatWithContent(content: string): Promise<void> {
    console.log(`Opening chat with content: ${content}`);
    return Promise.resolve();
  }

  copyToClipboard(content: string): Promise<void> {
    console.log(`Copying to clipboard: ${content}`);
    return Promise.resolve();
  }
}
