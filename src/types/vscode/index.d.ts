declare module "vscode" {
  export interface Disposable {
    dispose(): void;
  }
  export class Uri {
    readonly scheme: string;
    readonly fsPath: string;
    static file(path: string): Uri;
    static parse(value: string): Uri;
    static joinPath(base: Uri, ...paths: string[]): Uri;
    toString(skipEncoding?: boolean): string;
  }
  export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
    keys(): readonly string[];
  }
  export interface SecretStorage {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
  }
  export interface ExtensionContext {
    extensionUri: Uri;
    subscriptions: Disposable[];
    workspaceState: Memento;
    globalState: Memento;
    secrets: SecretStorage;
    storageUri?: Uri;
    globalStorageUri: Uri;
    extensionPath: string;
  }
  export interface StatusBarItem extends Disposable {
    name?: string;
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
  }
  export interface LogOutputChannel extends Disposable {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    appendLine(message: string): void;
    show(): void;
  }
  export interface TextDocument {
    uri: Uri;
    fileName: string;
    languageId: string;
    getText(range?: unknown): string;
  }
  export interface TextEditor {
    document: TextDocument;
  }
  export class Position {
    constructor(line: number, character: number);
    readonly line: number;
    readonly character: number;
  }
  export class Range {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    readonly start: Position;
    readonly end: Position;
  }
  export interface TextDocumentShowOptions {
    preview?: boolean;
    preserveFocus?: boolean;
    viewColumn?: ViewColumn;
    selection?: Range;
  }
  export interface WorkspaceFolder {
    uri: Uri;
    name: string;
    index: number;
  }
  export interface Webview {
    html: string;
    options: WebviewOptions;
    readonly cspSource: string;
    asWebviewUri(uri: Uri): Uri;
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(listener: (message: any) => any): Disposable;
  }
  export interface WebviewOptions {
    enableScripts?: boolean;
    localResourceRoots?: readonly Uri[];
  }
  export interface WebviewPanel extends Disposable {
    webview: Webview;
    reveal(column?: ViewColumn, preserveFocus?: boolean): void;
    onDidDispose(listener: () => any): Disposable;
  }
  export enum ViewColumn {
    One = 1,
    Two = 2
  }
  export enum StatusBarAlignment {
    Left = 1,
    Right = 2
  }
  export interface FileSystemWatcher extends Disposable {
    onDidCreate(listener: (uri: Uri) => any): Disposable;
    onDidChange(listener: (uri: Uri) => any): Disposable;
    onDidDelete(listener: (uri: Uri) => any): Disposable;
  }
  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: (e: any) => any): Disposable;
  }
  export class CancellationTokenSource implements Disposable {
    readonly token: CancellationToken;
    cancel(): void;
    dispose(): void;
  }
  export interface LanguageModelChatMessage {
    readonly role: number;
    readonly content: readonly unknown[];
  }
  export namespace LanguageModelChatMessage {
    function User(content: string, name?: string): LanguageModelChatMessage;
    function Assistant(content: string, name?: string): LanguageModelChatMessage;
  }
  export interface LanguageModelChatResponse {
    readonly text: AsyncIterable<string>;
  }
  export interface LanguageModelChat {
    readonly id: string;
    readonly vendor: string;
    readonly family: string;
    readonly version: string;
    readonly name: string;
    readonly maxInputTokens: number;
    sendRequest(
      messages: readonly LanguageModelChatMessage[],
      options: Record<string, unknown>,
      token: CancellationToken
    ): Thenable<LanguageModelChatResponse>;
  }
  export namespace lm {
    function selectChatModels(selector?: {
      vendor?: string;
      family?: string;
      version?: string;
      id?: string;
    }): Thenable<LanguageModelChat[]>;
  }
  export namespace commands {
    function registerCommand(command: string, callback: (...args: any[]) => any): Disposable;
    function executeCommand<T = unknown>(command: string, ...args: any[]): Thenable<T | undefined>;
    function getCommands(filterInternal?: boolean): Thenable<string[]>;
  }
  export interface Extension<T = unknown> {
    readonly packageJSON: any;
    readonly isActive: boolean;
    activate(): Thenable<T>;
  }
  export namespace extensions {
    const all: readonly Extension[];
    function getExtension<T = unknown>(extensionId: string): Extension<T> | undefined;
  }
  export namespace window {
    const activeTextEditor: TextEditor | undefined;
    function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    function createOutputChannel(name: string, options?: { log?: boolean }): LogOutputChannel;
    function showInputBox(options?: Record<string, unknown>): Thenable<string | undefined>;
    function showQuickPick<T>(
      items: readonly T[],
      options?: Record<string, unknown>
    ): Thenable<T | undefined>;
    function showWarningMessage<T extends string>(
      message: string,
      options: Record<string, unknown>,
      ...items: T[]
    ): Thenable<T | undefined>;
    function showTextDocument(
      document: TextDocument,
      options?: TextDocumentShowOptions
    ): Thenable<TextEditor>;
    function createWebviewPanel(
      viewType: string,
      title: string,
      showOptions: ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean },
      options?: {
        enableScripts?: boolean;
        retainContextWhenHidden?: boolean;
        localResourceRoots?: readonly Uri[];
      }
    ): WebviewPanel;
    function onDidChangeActiveTextEditor(
      listener: (editor: TextEditor | undefined) => any
    ): Disposable;
  }
  export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3
  }
  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
    update(section: string, value: unknown, target?: ConfigurationTarget | boolean): Thenable<void>;
  }
  export namespace workspace {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    function getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined;
    function asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string;
    function onDidChangeWorkspaceFolders(
      listener: (event: {
        added: readonly WorkspaceFolder[];
        removed: readonly WorkspaceFolder[];
      }) => any
    ): Disposable;
    function createFileSystemWatcher(globPattern: string): FileSystemWatcher;
    function getConfiguration(section?: string, scope?: Uri): WorkspaceConfiguration;
    function openTextDocument(uri: Uri): Thenable<TextDocument>;
  }
  export namespace env {
    const clipboard: { readText(): Thenable<string>; writeText(value: string): Thenable<void> };
    function asExternalUri(uri: Uri): Thenable<Uri>;
    function openExternal(uri: Uri): Thenable<boolean>;
  }
}
