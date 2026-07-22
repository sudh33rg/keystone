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
    if (child && child.type === "parameter") {
      const pattern = child.childForFieldName("pattern");
      if (pattern) params.push(pattern.text);
    }
  }
  return params;
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  const returnType = node.childForFieldName("return_type");
  return returnType ? returnType.text : undefined;
}

function isPublic(node: TreeSitterNode): boolean {
  const visMod = findChild(node, "visibility_modifier");
  return visMod !== null && visMod.text.startsWith("pub");
}

function extractScopedPath(node: TreeSitterNode): { path: string; name: string } {
  if (node.type === "scoped_identifier") {
    const pathNode = node.childForFieldName("path");
    const nameNode = node.childForFieldName("name");
    return { path: pathNode ? pathNode.text : "", name: nameNode ? nameNode.text : node.text };
  }
  return { path: "", name: node.text };
}

/** Rust extractor (ported from Understand-Anything). */
export class RustExtractor implements LanguageExtractor {
  readonly languageIds = ["rust"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const methodsByType = new Map<string, string[]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      switch (node.type) {
        case "function_item":
          this.extractFunction(node, functions);
          break;
        case "struct_item":
          this.extractStruct(node, classes);
          break;
        case "enum_item":
          this.extractEnum(node, classes);
          break;
        case "trait_item":
          this.extractTrait(node, classes);
          break;
        case "impl_item":
          this.extractImpl(node, functions, methodsByType);
          break;
        case "use_declaration":
          this.extractUseDeclaration(node, imports);
          break;
      }
    }
    for (const cls of classes) {
      const methods = methodsByType.get(cls.name);
      if (methods) cls.methods.push(...methods);
    }
    return { functions, classes, imports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const walk = (node: TreeSitterNode): void => {
      let pushed = false;
      if (node.type === "function_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushed = true;
        }
      }
      if (node.type === "call_expression" && functionStack.length > 0) {
        const callee = this.extractCalleeName(node);
        if (callee)
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee,
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

  private extractCalleeName(callNode: TreeSitterNode): string | null {
    const funcNode = callNode.child(0);
    if (!funcNode) return null;
    if (funcNode.type === "identifier") return funcNode.text;
    if (funcNode.type === "field_expression") {
      const field = funcNode.childForFieldName("field");
      const value = funcNode.childForFieldName("value");
      if (field && value) return `${value.text}.${field.text}`;
    }
    if (funcNode.type === "scoped_identifier") return funcNode.text;
    return funcNode.text;
  }

  private extractFunction(node: TreeSitterNode, functions: StructuralAnalysis["functions"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params: extractParams(node.childForFieldName("parameters") ?? null),
      returnType: extractReturnType(node),
    });
  }

  private extractStruct(node: TreeSitterNode, classes: StructuralAnalysis["classes"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body && body.type === "field_declaration_list") {
      for (const field of findChildren(body, "field_declaration")) {
        const fieldName = findChild(field, "field_identifier");
        if (fieldName) properties.push(fieldName.text);
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods: [],
      properties,
    });
  }

  private extractEnum(node: TreeSitterNode, classes: StructuralAnalysis["classes"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body && body.type === "enum_variant_list") {
      for (const variant of findChildren(body, "enum_variant")) {
        const v = variant.childForFieldName("name");
        if (v) properties.push(v.text);
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods: [],
      properties,
    });
  }

  private extractTrait(node: TreeSitterNode, classes: StructuralAnalysis["classes"]): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const methods: string[] = [];
    const body = findChild(node, "declaration_list");
    if (body) {
      for (const sig of findChildren(body, "function_signature_item")) {
        const s = findChild(sig, "identifier");
        if (s) methods.push(s.text);
      }
      for (const fn of findChildren(body, "function_item")) {
        const fnName = fn.childForFieldName("name");
        if (fnName) methods.push(fnName.text);
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties: [],
    });
  }

  private extractImpl(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    methodsByType: Map<string, string[]>,
  ): void {
    const typeNode = node.childForFieldName("type");
    const typeName = typeNode ? typeNode.text : null;
    const body = node.childForFieldName("body");
    if (!body) return;
    for (const fn of findChildren(body, "function_item")) {
      const nameNode = fn.childForFieldName("name");
      if (!nameNode) continue;
      functions.push({
        name: nameNode.text,
        lineRange: [fn.startPosition.row + 1, fn.endPosition.row + 1],
        params: extractParams(fn.childForFieldName("parameters") ?? null),
        returnType: extractReturnType(fn),
      });
      if (typeName) {
        if (!methodsByType.has(typeName)) methodsByType.set(typeName, []);
        methodsByType.get(typeName)!.push(nameNode.text);
      }
    }
  }

  private extractUseDeclaration(node: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    const argument = node.childForFieldName("argument");
    if (!argument) return;
    switch (argument.type) {
      case "identifier":
        imports.push({ source: argument.text, specifiers: [argument.text], lineNumber: node.startPosition.row + 1 });
        break;
      case "scoped_identifier": {
        const { path, name } = extractScopedPath(argument);
        imports.push({ source: path, specifiers: [name], lineNumber: node.startPosition.row + 1 });
        break;
      }
      case "use_wildcard": {
        const scopedId = findChild(argument, "scoped_identifier");
        imports.push({ source: scopedId ? scopedId.text : "", specifiers: ["*"], lineNumber: node.startPosition.row + 1 });
        break;
      }
      default:
        imports.push({ source: argument.text, specifiers: [argument.text], lineNumber: node.startPosition.row + 1 });
    }
  }
}
