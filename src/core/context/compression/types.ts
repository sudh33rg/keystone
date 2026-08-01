export type ContextPackItemKind = "file" | "test" | "script" | "config";

export type ContextPackItem = {
  kind: ContextPackItemKind;
  path?: string;
  name: string;
  reason: string;
  estimatedTokens: number;
};

export type ContextPack = {
  task: string;
  deliveryMode: "adaptive-segments";
  estimatedTokens: number;
  items: ContextPackItem[];
};
