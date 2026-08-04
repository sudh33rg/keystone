import type { LanguageExtractor, StructuralAnalysis, CallGraphEntry } from "../LanguageExtractor";
import type { TreeSitterNode } from "../TreeSitterNode";

function findChild(node: TreeSitterNode, type: string): TreeSitterNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

function findChildren(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) result.push(child);
  }
  return result;
}

function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];
  for (const decl of findChildren(paramsNode, "formal_parameter")) {
    const nameNode = decl.childForFieldName("name");
    if (nameNode) params.push(nameNode.text);
  }
  for (const spread of findChildren(paramsNode, "spread_parameter")) {
    const nameNode = spread.childForFieldName("name");
    if (nameNode) params.push(nameNode.text);
  }
  return params;
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeNode = node.childForFieldName("type");
  return typeNode ? typeNode.text : undefined;
}

function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1] ?? path;
}

/** Java extractor (ported from Understand-Anything). */
export class JavaExtractor implements LanguageExtractor {
  readonly languageIds = ["java"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          break;
        case "class_declaration":
        case "enum_declaration":
        case "record_declaration":
          this.extractClass(node, functions, classes);
          break;
        case "interface_declaration":
          this.extractInterface(node, functions, classes);
          break;
      }
    }
    return { functions, classes, imports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const walk = (node: TreeSitterNode): void => {
      let pushed = false;
      if (node.type === "method_declaration" || node.type === "constructor_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushed = true;
        }
      }
      if (node.type === "method_invocation" && functionStack.length > 0) {
        const callee = this.extractMethodInvocationName(node);
        if (callee)
          entries.push({
            caller: functionStack[functionStack.length - 1]!,
            callee,
            lineNumber: node.startPosition.row + 1,
          });
      }
      if (node.type === "object_creation_expression") {
        const typeNode = node.childForFieldName("type");
        if (typeNode && functionStack.length > 0)
          entries.push({
            caller: functionStack[functionStack.length - 1]!,
            callee: `new ${typeNode.text}`,
            lineNumber: node.startPosition.row + 1,
          });
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
      if (pushed) functionStack.pop();
    };
    walk(rootNode);
    return entries;
  }

  private extractMethodInvocationName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return null;
    const objectNode = node.childForFieldName("object");
    return objectNode ? `${objectNode.text}.${nameNode.text}` : nameNode.text;
  }

  private extractImport(node: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    const hasAsterisk = findChild(node, "asterisk") !== null;
    const scopedId = findChild(node, "scoped_identifier");
    if (!scopedId) return;
    const fullPath = scopedId.text;
    imports.push({
      source: fullPath,
      specifiers: [hasAsterisk ? "*" : lastComponent(fullPath)],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractClass(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body) this.extractClassBodyMembers(body, methods, properties, functions);
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
  }

  private extractInterface(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body) {
      for (const m of findChildren(body, "method_declaration")) {
        const mn = m.childForFieldName("name");
        if (mn) methods.push(mn.text);
      }
      for (const f of findChildren(body, "constant_declaration")) {
        for (const d of findChildren(f, "variable_declarator")) {
          const dn = d.childForFieldName("name");
          if (dn) properties.push(dn.text);
        }
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
  }

  private extractClassBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;
      switch (child.type) {
        case "enum_body_declarations":
          this.extractClassBodyMembers(child, methods, properties, functions);
          break;
        case "method_declaration": {
          const mn = child.childForFieldName("name");
          if (mn) {
            methods.push(mn.text);
            functions.push({
              name: mn.text,
              lineRange: [child.startPosition.row + 1, child.endPosition.row + 1],
              params: extractParams(child.childForFieldName("parameters") ?? null),
              returnType: extractReturnType(child),
            });
          }
          break;
        }
        case "constructor_declaration": {
          const cn = child.childForFieldName("name");
          if (cn) {
            methods.push(cn.text);
            functions.push({
              name: cn.text,
              lineRange: [child.startPosition.row + 1, child.endPosition.row + 1],
              params: extractParams(child.childForFieldName("parameters") ?? null),
            });
          }
          break;
        }
        case "field_declaration":
          for (const d of findChildren(child, "variable_declarator")) {
            const dn = d.childForFieldName("name");
            if (dn) properties.push(dn.text);
          }
          break;
      }
    }
  }
}
