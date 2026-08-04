import type { LanguageExtractor, StructuralAnalysis, CallGraphEntry } from "../LanguageExtractor";
import type { TreeSitterNode } from "../TreeSitterNode";

function getStringValue(node: TreeSitterNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "string_fragment") return child.text;
  }
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];
  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;
    if (child.type === "required_parameter" || child.type === "optional_parameter") {
      const ident = child.childForFieldName("pattern") ?? child.childForFieldName("name");
      if (ident) params.push(ident.text);
      else {
        for (let j = 0; j < child.childCount; j++) {
          const c = child.child(j);
          if (c && c.type === "identifier") {
            params.push(c.text);
            break;
          }
        }
      }
    } else if (child.type === "identifier") params.push(child.text);
    else if (child.type === "rest_pattern" || child.type === "rest_element") {
      const ident = child.children.find((c) => c.type === "identifier");
      if (ident) params.push("..." + ident.text);
    }
  }
  return params;
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeAnnotation = node.childForFieldName("return_type");
  if (typeAnnotation && typeAnnotation.type === "type_annotation") {
    const text = typeAnnotation.text;
    return text.startsWith(":") ? text.slice(1).trim() : text;
  }
  return undefined;
}

function extractImportSpecifiers(importClause: TreeSitterNode): string[] {
  const specifiers: string[] = [];
  for (let i = 0; i < importClause.childCount; i++) {
    const child = importClause.child(i);
    if (!child) continue;
    if (child.type === "named_imports") {
      for (const spec of findChildren(child, "import_specifier")) {
        const alias = spec.childForFieldName("alias");
        const name = spec.childForFieldName("name");
        specifiers.push(alias ? alias.text : name ? name.text : spec.text);
      }
    } else if (child.type === "namespace_import") {
      const ident = child.children.find((c) => c.type === "identifier");
      if (ident) specifiers.push("* as " + ident.text);
    } else if (child.type === "identifier") specifiers.push(child.text);
  }
  return specifiers;
}

function findChildren(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) result.push(child);
  }
  return result;
}

function findIdentifier(node: TreeSitterNode | null): string | undefined {
  if (!node) return undefined;
  const id = node.childForFieldName("name") ?? node.children.find((c) => c.type === "identifier");
  return id?.text;
}

/** TypeScript / JavaScript extractor (ported from Understand-Anything). */
export class TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ["typescript", "javascript"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      switch (node.type) {
        case "function_declaration":
          this.extractFunction(node, functions);
          break;
        case "abstract_class_declaration":
        case "class_declaration":
          this.extractClass(node, classes);
          break;
        case "lexical_declaration":
        case "variable_declaration":
          this.extractVariableDeclarations(node, functions);
          break;
        case "import_statement":
          this.extractImport(node, imports);
          break;
        case "export_statement":
          this.processExportStatement(node, functions, classes, imports);
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
      const isFunctionLike =
        node.type === "function_declaration" ||
        node.type === "method_definition" ||
        node.type === "arrow_function" ||
        node.type === "function_expression";
      if (isFunctionLike) {
        let name: string | undefined;
        if (node.type === "function_declaration")
          name = findIdentifier(node) ?? node.children.find((c) => c.type === "identifier")?.text;
        else if (node.type === "method_definition")
          name = node.children.find((c) => c.type === "property_identifier")?.text;
        else if (node.type === "arrow_function" || node.type === "function_expression") {
          const parent = node.parent;
          if (parent && parent.type === "variable_declarator")
            name = parent.childForFieldName("name")?.text;
        }
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      }
      if (node.type === "call_expression") {
        const callee = node.childForFieldName("function");
        if (callee && functionStack.length > 0)
          entries.push({
            caller: functionStack[functionStack.length - 1]!,
            callee: callee.text,
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

  private extractFunction(node: TreeSitterNode, functions: StructuralAnalysis["functions"]): void {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "identifier");
    if (!nameNode) return;
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params: extractParams(node.childForFieldName("parameters") ?? null),
      returnType: extractReturnType(node),
    });
  }

  private extractClass(node: TreeSitterNode, classes: StructuralAnalysis["classes"]): void {
    const nameNode = node.children.find((c) => c.type === "type_identifier" || c.type === "identifier");
    if (!nameNode) return;
    const methods: string[] = [];
    const properties: string[] = [];
    const classBody = node.children.find((c) => c.type === "class_body");
    if (classBody) {
      for (let j = 0; j < classBody.childCount; j++) {
        const member = classBody.child(j);
        if (!member) continue;
        if (member.type === "method_definition" || member.type === "abstract_method_signature") {
          const m = member.children.find((c) => c.type === "property_identifier");
          if (m) methods.push(m.text);
        } else if (
          member.type === "public_field_definition" ||
          member.type === "property_definition"
        ) {
          const p = member.children.find((c) => c.type === "property_identifier");
          if (p) properties.push(p.text);
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

  private extractVariableDeclarations(node: TreeSitterNode, functions: StructuralAnalysis["functions"]): void {
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j);
      if (!child || child.type !== "variable_declarator") continue;
      const nameNode = child.childForFieldName("name");
      const valueNode = child.childForFieldName("value");
      if (
        nameNode &&
        valueNode &&
        (valueNode.type === "arrow_function" ||
          valueNode.type === "function_expression" ||
          valueNode.type === "function")
      ) {
        functions.push({
          name: nameNode.text,
          lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          params: extractParams(valueNode.childForFieldName("parameters") ?? null),
          returnType: extractReturnType(valueNode),
        });
      }
    }
  }

  private extractImport(node: TreeSitterNode, imports: StructuralAnalysis["imports"]): void {
    const sourceNode = node.children.find((c) => c.type === "string");
    if (!sourceNode) return;
    const source = getStringValue(sourceNode);
    const importClause = node.children.find((c) => c.type === "import_clause");
    const specifiers = importClause ? extractImportSpecifiers(importClause) : [];
    imports.push({ source, specifiers, lineNumber: node.startPosition.row + 1 });
  }

  private processExportStatement(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
  ): void {
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j);
      if (!child) continue;
      switch (child.type) {
        case "function_declaration":
          this.extractFunction(child, functions);
          break;
        case "abstract_class_declaration":
        case "class_declaration":
          this.extractClass(child, classes);
          break;
        case "lexical_declaration":
        case "variable_declaration":
          this.extractVariableDeclarations(child, functions);
          break;
        case "export_clause":
          for (const spec of findChildren(child, "export_specifier")) {
            const alias = spec.childForFieldName("alias");
            const name = spec.childForFieldName("name");
            imports.push({
              source: (alias ?? name ?? spec).text,
              specifiers: [(alias ?? name ?? spec).text],
              lineNumber: node.startPosition.row + 1,
            });
          }
          break;
      }
    }
  }
}
