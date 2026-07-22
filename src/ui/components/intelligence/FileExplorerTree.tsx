import { useMemo, useState } from "react";

export interface FileTreeNode {
  id: string;
  label: string;
  kind: "directory" | "file";
  depth: number;
  children?: FileTreeNode[];
  entityId?: string;
}

interface FileExplorerTreeProps {
  files: Array<{ id: string; relativePath: string; analysisLevel?: string }>;
  onSelectEntity?: (entityId: string) => void;
  defaultExpanded?: boolean;
}

export function FileExplorerTree({ files, onSelectEntity, defaultExpanded = false }: FileExplorerTreeProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded ? ["root"] : []));

  const tree = useMemo(() => {
    const roots: FileTreeNode[] = [];
    const index = new Map<string, FileTreeNode>();
    for (const file of files) {
      const segments = file.relativePath.split("/").filter(Boolean);
      let current: FileTreeNode[] = roots;
      let parentPath = "";
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        parentPath = parentPath ? `${parentPath}/${segment}` : segment;
        const isLeaf = i === segments.length - 1;
        const existing = current.find((item) => item.label === segment);
        if (existing) {
          if (isLeaf) {
            existing.id = file.id;
            existing.entityId = file.id;
            existing.kind = "file";
          }
          current = existing.children ?? [];
          continue;
        }
        const node: FileTreeNode = {
          id: isLeaf ? file.id : parentPath,
          label: segment,
          kind: isLeaf ? "file" : "directory",
          depth: i,
          children: isLeaf ? undefined : [],
          entityId: isLeaf ? file.id : undefined,
        };
        current.push(node);
        index.set(parentPath, node);
        current = node.children ?? [];
      }
    }
    return roots;
  }, [files]);

  const filtered = useMemo(() => {
    if (!query.trim()) return tree;
    const lower = query.toLowerCase();
    const walk = (nodes: FileTreeNode[]): FileTreeNode[] => {
      const out: FileTreeNode[] = [];
      for (const node of nodes) {
        const matchesSelf = node.label.toLowerCase().includes(lower);
        const childMatches = node.kind === "directory" ? walk(node.children ?? []) : [];
        if (matchesSelf || childMatches.length) {
          out.push({ ...node, children: childMatches });
        }
      }
      return out;
    };
    return walk(tree);
  }, [query, tree]);

  const toggle = (node: FileTreeNode): void => {
    const next = new Set(expanded);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    setExpanded(next);
  };

  return (
    <section className="file-explorer-tree" aria-label="File explorer tree">
      <label htmlFor="file-explorer-query" className="file-explorer-query-label">Filter files</label>
      <input id="file-explorer-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a file name…" />
      <div className="file-explorer-nodes">
        {filtered.length === 0 && <div className="empty">No matching files</div>}
        {filtered.map((node) => (
          <FileTreeNode key={node.id} node={node} expanded={expanded} onToggle={toggle} onSelect={onSelectEntity} query={query} />
        ))}
      </div>
    </section>
  );
}

interface FileTreeNodeProps {
  node: FileTreeNode;
  expanded: Set<string>;
  onToggle: (node: FileTreeNode) => void;
  onSelect?: (entityId: string) => void;
  query: string;
}

function FileTreeNode({ node, expanded, onToggle, onSelect, query }: FileTreeNodeProps) {
  const isDirectory = node.kind === "directory";
  const isExpanded = expanded.has(node.id);
  return (
    <div style={{ paddingLeft: node.depth * 12 }} className={`file-node ${node.kind}`} aria-expanded={isDirectory ? isExpanded : undefined}>
      <button onClick={() => isDirectory ? onToggle(node) : onSelect?.(node.entityId ?? node.id)} title={node.label}>
        {isDirectory ? <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span> : <span aria-hidden="true">•</span>}
        <span className="file-node-label">{highlight(node.label, query)}</span>
      </button>
      {isDirectory && isExpanded && (node.children ?? []).length > 0 && (
        <div>
          {(node.children ?? []).map((child) => <FileTreeNode key={child.id} node={child} expanded={expanded} onToggle={onToggle} onSelect={onSelect} query={query} />)}
        </div>
      )}
      {isDirectory && isExpanded && (node.children ?? []).length === 0 && <div className="empty">Empty</div>}
    </div>
  );
}

function highlight(label: string, query: string): React.ReactNode {
  if (!query.trim()) return label;
  const lower = label.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index === -1) return label;
  return <>
    {label.slice(0, index)}
    <mark>{label.slice(index, index + query.trim().length)}</mark>
    {label.slice(index + query.trim().length)}
  </>;
}
