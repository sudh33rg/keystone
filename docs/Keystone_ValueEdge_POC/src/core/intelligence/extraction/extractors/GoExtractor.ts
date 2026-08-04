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
  for (const decl of findChildren(paramsNode, "parameter_declaration")) {
    for (let i = 0; i < decl.childCount; i++) {
      const child = decl.child(i);
      if (child && child.type === "identifier") params.push(child.text);
    }
  }
  return params;
}

function extractResultType(node: TreeSitterNode): string | undefined {
  const result = node.childForFieldName("result");
  return result ? result.text : undefined;
}

function extractReceiverType(receiverNode: TreeSitterNode): string | undefined {
  const decl = findChild(receiverNode, "parameter_declaration");
  if (!decl) return undefined;
  for (let i = 0; i < decl.childCount; i++) {
    const child = decl.child(i);
    if (!child) continue;
    if (child.type === "type_identifier") return child.text;
    if (child.type === "pointer_type") {
      const typeId = findChild(child, "type_identifier");
      if (typeId) return typeId.text;
    }
  }
  return undefined;
}

/** Go extractor (ported from Understand-Anything). */
export class GoExtractor implements LanguageExtractor {
  readonly languageIds = ["go"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const methodsByReceiver = new Map<string, string[]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      switch (node.type) {
        case "function_declaration":
          this.extractFunction(node, functions);
          break;
        case "method_declaration":
          this.extractMethod(node, functions, methodsByReceiver);
          break;
        case "type_declaration":
          this.extractTypeDeclaration(node, classes);
          break;
        case "import_declaration":
          this.extractImportDeclaration(node, imports);
          break;
      }
    }
    for (const cls of classes) {
      const methods = methodsByReceiver.get(cls.name);
      if (methods) cls.methods.push(...methods);
    }
    return { functions, classes, imports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const walk = (node: TreeSitterNode): void => {
      let pushed = false;
      if (node.type === "function_declaration" || node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushed = true;
        }
      }
      if (node.type === "call_expression") {
        const calleeNode = node.childForFieldName("function");
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
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params: extractParams(node.childForFieldName("parameters") ?? null),
      returnType: extractResultType(node),
    });
  }

  private extractMethod(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    methodsByReceiver: Map<string, string[]>,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params: extractParams(node.childForFieldName("parameters") ?? null),
      returnType: extractResultType(node),
    });
    const receiverNode = node.childForFieldName("receiver");
    if (receiverNode) {
      const receiverType = extractReceiverType(receiverNode);
      if (receiverType) {
        if (!methodsByReceiver.has(receiverType)) methodsByReceiver.set(receiverType, []);
        methodsByReceiver.get(receiverType)!.push(nameNode.text);
      }
    }
  }

  private extractTypeDeclaration(node: TreeSitterNode, classes: StructuralAnalysis["classes"]): void {
    const typeSpec = findChild(node, "type_spec");
    if (!typeSpec) return;
    const nameNode = typeSpec.childForFieldName("name");
    const typeNode = typeSpec.childForFieldName("type");
    if (!nameNode || !typeNode) return;
    if (typeNode.type === "struct_type") this.extractStruct(node, nameNode, typeNode, classes);
    else if (typeNode.type === "interface_type") this.extractInterface(node, nameNode, typeNode, classes);
  }

  private extractStruct(
    declNode: TreeSitterNode,
    nameNode: TreeSitterNode,
    structNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const properties: string[] = [];
    const fieldList = findChild(structNode, "field_declaration_list");
    if (fieldList) {
      for (const field of findChildren(fieldList, "field_declaration")) {
        for (let i = 0; i < field.childCount; i++) {
          const child = field.child(i);
          if (child && child.type === "field_identifier") properties.push(child.text);
        }
      }
    }
    classes.push({
      name: nameNode.text,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      methods: [],
      properties,
    });
  }

  private extractInterface(
    declNode: TreeSitterNode,
    nameNode: TreeSitterNode,
    interfaceNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const methods: string[] = [];
    for (const elem of findChildren(interfaceNode, "method_elem")) {
      const methName = elem.childForFieldName("name");
      if (methName) methods.push(methName.text);
    }
    classes.push({
      name: nameNode.text,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      methods,
      properties: [],
    });
  }

  private extractImportDeclaration(node: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    const specList = findChild(node, "import_spec_list");
    if (specList) {
      for (const spec of findChildren(specList, "import_spec")) this.extractImportSpec(spec, imports);
    } else {
      const spec = findChild(node, "import_spec");
      if (spec) this.extractImportSpec(spec, imports);
    }
  }

  private extractImportSpec(spec: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    const pathNode = spec.childForFieldName("path");
    if (!pathNode) return;
    const pathContent = findChild(pathNode, "interpreted_string_literal_content");
    const source = pathContent ? pathContent.text : pathNode.text.replace(/^"|"$/g, "");
    const nameNode = spec.childForFieldName("name");
    const specifier = nameNode ? nameNode.text : (source.split("/").pop() ?? source);
    imports.push({ source, specifiers: [specifier], lineNumber: spec.startPosition.row + 1 });
  }
}