import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  window: { activeTextEditor: undefined, visibleTextEditors: [] },
  workspace: {},
  Uri: {},
  FileType: { Directory: 2 },
}));

import { DEVELOPMENT_FILE_EXCLUDE_GLOB, selectDevelopmentEditor } from "../../../src/extension/development/VsCodeDevelopmentAdapter";

describe("selectDevelopmentEditor", () => {
  it("uses the last visible file editor while the Keystone webview owns focus", () => {
    const fileEditor = { document: { uri: { scheme: "file" } } } as never;
    const outputEditor = { document: { uri: { scheme: "output" } } } as never;

    expect(selectDevelopmentEditor(undefined, [outputEditor, fileEditor])).toBe(fileEditor);
  });

  it("prefers the active file editor", () => {
    const active = { document: { uri: { scheme: "file" } } } as never;
    const visible = { document: { uri: { scheme: "file" } } } as never;

    expect(selectDevelopmentEditor(active, [visible])).toBe(active);
  });

  it("keeps Keystone persistence files out of the source picker", () => {
    expect(DEVELOPMENT_FILE_EXCLUDE_GLOB).toContain("**/.keystone/**");
  });
});
