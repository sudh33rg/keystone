/**
 * VSCode API wrapper for Keystone.
 *
 * This file provides a mock implementation of the VSCodeAPI for testing and
 * serves as a contract for how Keystone will interact with VS Code APIs.
 */

import { VSCodeAPI } from './contracts/vscodeApi';

/**
 * Mock implementation of VSCodeAPI for testing
 */
export class MockVSCodeAPI implements VSCodeAPI {
  async getChatParticipants(): Promise<any[]> {
    return [
      {
        id: 'keystone-chat-participant',
        name: 'Keystone',
        description: 'Keystone chat participant for workflow execution'
      }
    ];
  }

  async getLanguageModelProviders(): Promise<any[]> {
    return [
      {
        id: 'mock-lm-provider',
        name: 'Mock Language Model Provider',
        models: ['gpt-4', 'claude-3']
      }
    ];
  }

  async getCommands(): Promise<string[]> {
    return [
      'keystone.startWorkflow',
      'keystone.resumeWorkflow',
      'keystone.open',
      'copilot.generate'
    ];
  }

  async getExtensions(): Promise<any[]> {
    return [
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
    ];
  }

  async openChatWithContent(content: string): Promise<void> {
    console.log(`Opening chat with content: ${content}`);
  }

  async copyToClipboard(content: string): Promise<void> {
    console.log(`Copying to clipboard: ${content}`);
  }
}