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
  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;
    switch (child.type) {
      case "identifier":
        if (child.text !== "self" && child.text !== "cls") params.push(child.text);
        break;
      case "typed_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") params.push(ident.text);
        break;
      }
      case "default_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") params.push(ident.text);
        break;
      }
      case "typed_default_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") params.push(ident.text);
        break;
      }
      case "list_splat_pattern": {
        const ident = findChild(child, "identifier");
        if (ident) params.push("*" + ident.text);
        break;
      }
      case "dictionary_splat_pattern": {
        const ident = findChild(child, "identifier");
        if (ident) params.push("**" + ident.text);
        break;
      }
    }
  }
  return params;
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  const returnType = node.childForFieldName("return_type");
  return returnType ? returnType.text : undefined;
}

function unwrapDecorated(node: TreeSitterNode): TreeSitterNode {
  if (node.type === "decorated_definition") {
    const inner = findChild(node, "function_definition") ?? findChild(node, "class_definition");
    if (inner) return inner;
  }
  return node;
}

/**
 * Python extractor (ported from Understand-Anything). Handles functions,
 * classes, imports, and call graphs. Python has no formal export syntax, so
 * all top-level function and class definitions are treated as exports.
 */
export class PythonExtractor implements LanguageExtractor {
  readonly languageIds = ["python"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      const inner = unwrapDecorated(node);
      switch (inner.type) {
        case "function_definition":
          this.extractFunction(inner, functions);
          break;
        case "class_definition":
          this.extractClass(inner, classes);
          break;
        case "import_statement":
          this.extractImport(inner, imports);
          break;
        case "import_from_statement":
          this.extractFromImport(inner, imports);
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
      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushed = true;
        }
      }
      if (node.type === "call") {
        const calleeNode = node.children.find(
          (c) => c.type === "identifier" || c.type === "attribute",
        );
        if (calleeNode && functionStack.length > 0) {
          entries.push({
            caller: functionStack[functionStack.length - 1]!,
            callee: calleeNode.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
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

  private extractFunction(node: TreeSitterNode, functions: StructuralAnalysis["functions"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const params = extractParams(node.childForFieldName("parameters") ?? null);
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
      returnType: extractReturnType(node),
    });
  }

  private extractClass(node: TreeSitterNode, classes: StructuralAnalysis["classes"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (!member) continue;
        const inner = unwrapDecorated(member);
        if (inner.type === "function_definition") {
          const m = inner.childForFieldName("name");
          if (m) methods.push(m.text);
        }
        if (member.type === "expression_statement") {
          const assignment = findChild(member, "assignment");
          if (assignment) {
            const typeNode = findChild(assignment, "type");
            const nameIdent = findChild(assignment, "identifier");
            if (typeNode && nameIdent) properties.push(nameIdent.text);
          }
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

  private extractImport(node: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    for (const dn of findChildren(node, "dotted_name")) {
      imports.push({ source: dn.text, specifiers: [dn.text], lineNumber: node.startPosition.row + 1 });
    }
    for (const ai of findChildren(node, "aliased_import")) {
      const dn = findChild(ai, "dotted_name");
      const alias = ai.children.find((c) => c.type === "identifier");
      if (dn) imports.push({ source: dn.text, specifiers: [alias ? alias.text : dn.text], lineNumber: node.startPosition.row + 1 });
    }
  }

  private extractFromImport(node: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    const moduleNode = node.childForFieldName("module_name");
    const source = moduleNode ? moduleNode.text : "";
    const moduleNodeId = moduleNode?.text;
    const specifiers: string[] = [];
    for (const dn of findChildren(node, "dotted_name")) {
      if (dn.text === moduleNodeId) continue;
      specifiers.push(dn.text);
    }
    for (const ai of findChildren(node, "aliased_import")) {
      const alias = ai.children.find((c) => c.type === "identifier");
      if (alias) specifiers.push(alias.text);
    }
    if (findChild(node, "wildcard_import")) specifiers.push("*");
    imports.push({ source, specifiers, lineNumber: node.startPosition.row + 1 });
  }
}
