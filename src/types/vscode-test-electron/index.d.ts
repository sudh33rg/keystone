declare module "@vscode/test-electron" {
  export interface RunTestsOptions {
    extensionDevelopmentPath: string;
    extensionTestsPath: string;
    launchArgs?: string[];
    extensionTestsEnv?: Record<string, string | undefined>;
    version?: string;
    vscodeExecutablePath?: string;
  }
  export function runTests(options: RunTestsOptions): Promise<number>;
}
