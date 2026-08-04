import type { SemanticParser } from "./SemanticModel";

export class ParserRegistry {
  constructor(private readonly parsers: readonly SemanticParser[]) {}

  forLanguage(language: string): SemanticParser | undefined {
    return this.parsers.find((parser) => parser.supports(language));
  }

  versions(): Record<string, string> {
    return Object.fromEntries(this.parsers.map((parser) => [parser.id, parser.version]));
  }
}
