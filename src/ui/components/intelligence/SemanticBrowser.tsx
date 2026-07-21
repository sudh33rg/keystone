import { useCallback, useEffect, useState } from "react";
import type {
  IntelligenceEntityDetails,
  IntelligenceNeighborhood,
  IntelligenceSearchResult,
} from "../../../shared/contracts/intelligence";
import type { HostBridge } from "../../services/HostBridge";
import { CodeAnalysis } from "./CodeAnalysis";
import { TechnologyCoverage } from "./TechnologyCoverage";
import { QueryWorkspace } from "./QueryWorkspace";

const EXPLORER_GROUPS = [
  {
    label: "APIs and contracts",
    types: ["keystone.core.ApiContract", "keystone.core.Endpoint", "keystone.core.Schema"],
  },
  {
    label: "Data",
    types: [
      "keystone.core.Table",
      "keystone.core.Column",
      "keystone.core.OrmEntity",
      "keystone.core.Migration",
    ],
  },
  {
    label: "Tests",
    types: ["keystone.core.TestSuite", "keystone.core.TestCase"],
  },
  {
    label: "Build",
    types: ["keystone.core.Package", "keystone.core.BuildTarget", "keystone.core.BuildCommand"],
  },
  {
    label: "Delivery",
    types: ["keystone.core.Pipeline", "keystone.core.Job", "keystone.core.Step"],
  },
  {
    label: "Infrastructure",
    types: [
      "keystone.core.InfrastructureResource",
      "keystone.core.Service",
      "keystone.core.Deployment",
    ],
  },
  {
    label: "Documentation",
    types: [
      "keystone.core.Document",
      "keystone.core.Section",
      "keystone.core.ArchitectureDecision",
    ],
  },
  {
    label: "Configuration",
    types: ["keystone.core.ConfigurationKey", "keystone.core.EnvironmentVariable"],
  },
];

export interface IntelligenceBrowseDetail {
  query?: string;
  entityTypes?: string[];
  languages?: string[];
}

export function SemanticBrowser({
  bridge,
  initialQuery = "",
  initialEntityId,
}: {
  bridge: HostBridge;
  initialQuery?: string;
  initialEntityId?: string;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState("");
  const [language, setLanguage] = useState("");
  const [result, setResult] = useState<IntelligenceSearchResult>();
  const [entity, setEntity] = useState<IntelligenceEntityDetails>();
  const [neighborhood, setNeighborhood] = useState<IntelligenceNeighborhood>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const reportError = useCallback((message: string) => setError(message), []);

  const search = (cursor?: string): void => {
    setLoading(true);
    setError(undefined);
    void bridge
      .request("intelligence/search", {
        query,
        limit: 20,
        ...(entityType ? { entityTypes: [entityType] } : {}),
        ...(language ? { languages: [language] } : {}),
        ...(cursor ? { cursor } : {}),
      })
      .then((next) =>
        setResult((previous) =>
          cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next,
        ),
      )
      .catch(showError(setError))
      .finally(() => setLoading(false));
  };

  const inspect = (id: string): void => {
    setLoading(true);
    setNeighborhood(undefined);
    void bridge
      .request("intelligence/entity", { id })
      .then((value) => setEntity(value))
      .catch(showError(setError))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!initialEntityId) return;
    void bridge
      .request("intelligence/entity", { id: initialEntityId })
      .then((value) => setEntity(value))
      .catch(showError(setError));
  }, [bridge, initialEntityId]);

  const graph = (id: string): void => {
    setLoading(true);
    void bridge
      .request("intelligence/neighborhood", {
        ids: [id],
        direction: "both",
        maxDepth: 1,
        maxNodes: 30,
        minimumConfidence: 0,
      })
      .then(setNeighborhood)
      .catch(showError(setError))
      .finally(() => setLoading(false));
  };

  const browse = (types: string[]): void => {
    setQuery("");
    setEntityType("");
    setLoading(true);
    setError(undefined);
    void bridge
      .request("intelligence/search", {
        query: "",
        limit: 20,
        entityTypes: types,
      })
      .then(setResult)
      .catch(showError(setError))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<IntelligenceBrowseDetail>).detail;
      const nextQuery = detail.query ?? "";
      const types = detail.entityTypes;
      const languages = detail.languages;
      setQuery(nextQuery);
      setEntityType(types?.length === 1 ? types[0]! : "");
      setLanguage(languages?.length === 1 ? languages[0]! : "");
      setLoading(true);
      setError(undefined);
      setEntity(undefined);
      setNeighborhood(undefined);
      void bridge
        .request("intelligence/search", {
          query: nextQuery,
          limit: 20,
          ...(types?.length ? { entityTypes: types } : {}),
          ...(languages?.length ? { languages } : {}),
        })
        .then(setResult)
        .catch(showError(setError))
        .finally(() => setLoading(false));
      window.requestAnimationFrame(() =>
        document
          .querySelector(".semantic-search")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    };
    window.addEventListener("keystone:intelligence-browse", listener);
    return () => window.removeEventListener("keystone:intelligence-browse", listener);
  }, [bridge]);

  return (
    <section className="semantic-browser" aria-label="Semantic intelligence browser">
      <QueryWorkspace key={initialQuery} bridge={bridge} initialInput={initialQuery} />
      <TechnologyCoverage bridge={bridge} />
      <nav className="intelligence-explorer-groups" aria-label="Intelligence explorer groups">
        {EXPLORER_GROUPS.map((group) => (
          <button key={group.label} className="ghost-button" onClick={() => browse(group.types)}>
            {group.label}
          </button>
        ))}
      </nav>
      <div className="semantic-search">
        <label htmlFor="intelligence-search">Search semantic intelligence</label>
        <div>
          <input
            id="intelligence-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") search();
            }}
            placeholder="Class, function, test, route, configuration…"
          />
          <select
            aria-label="Entity type"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
          >
            <option value="">All entity types</option>
            <option value="keystone.core.Class">Classes</option>
            <option value="keystone.core.Function">Functions</option>
            <option value="keystone.core.Component">Components</option>
            <option value="keystone.core.TestCase">Tests</option>
            <option value="keystone.core.Route">Routes</option>
            <option value="keystone.core.ConfigurationKey">Configuration</option>
          </select>
          <select
            aria-label="Language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">All languages</option>
            <option value="typescript">TypeScript</option>
            <option value="typescriptreact">TSX</option>
            <option value="javascript">JavaScript</option>
            <option value="javascriptreact">JSX</option>
          </select>
          <button className="primary-button" onClick={() => search()} disabled={loading}>
            Search
          </button>
        </div>
      </div>
      {error && (
        <p className="semantic-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="semantic-layout">
          <section className="semantic-results" aria-label="Semantic search results">
            <h2>
              Results <span>{result.total}</span>
            </h2>
            {result.items.length === 0 ? (
              <p>No matching entities.</p>
            ) : (
              result.items.map((item) => (
                <button
                  key={item.id}
                  className={entity?.entity.id === item.id ? "selected" : ""}
                  onClick={() => inspect(item.id)}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {displayType(item.type)} · {item.language} · {Math.round(item.confidence * 100)}
                    %
                  </span>
                  <small>
                    {item.qualifiedName}
                    <br />
                    {item.relativePath} · generation {item.generation}
                  </small>
                </button>
              ))
            )}
            {result.nextCursor && (
              <button
                className="ghost-button"
                onClick={() => search(result.nextCursor)}
                disabled={loading}
              >
                Load more
              </button>
            )}
          </section>
          {entity && (
            <EntityInspector
              bridge={bridge}
              entity={entity}
              neighborhood={neighborhood}
              onError={reportError}
              onGraph={() => graph(entity.entity.id)}
              onOpen={() => {
                void bridge
                  .request("intelligence/source/open", {
                    relativePath: entity.entity.relativePath,
                    ...(entity.entity.sourceRange ? { range: entity.entity.sourceRange } : {}),
                  })
                  .catch(showError(setError));
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function EntityInspector({
  bridge,
  entity,
  neighborhood,
  onGraph,
  onOpen,
  onError,
}: {
  bridge: HostBridge;
  entity: IntelligenceEntityDetails;
  neighborhood?: IntelligenceNeighborhood;
  onGraph: () => void;
  onOpen: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  return (
    <article className="entity-inspector" aria-label="Entity inspector">
      <div className="entity-heading">
        <div>
          <small>{displayType(entity.entity.type)}</small>
          <h2>{entity.entity.qualifiedName}</h2>
        </div>
        <span>{Math.round(entity.entity.confidence * 100)}%</span>
      </div>
      {entity.entity.signature && <pre>{entity.entity.signature}</pre>}
      <p>
        {entity.entity.relativePath}
        {entity.entity.sourceRange ? `:${entity.entity.sourceRange.startLine + 1}` : ""}
      </p>
      <p className="entity-freshness">
        Generation {entity.generation}
        {entity.entity.parentId ? ` · Parent ${shortId(entity.entity.parentId)}` : ""}
      </p>
      <div className="entity-actions">
        <button className="primary-button" onClick={onOpen}>
          Open in VS Code
        </button>
        <button className="ghost-button" onClick={onGraph}>
          Show neighborhood
        </button>
      </div>
      <RelationshipList title="Outgoing" items={entity.outgoing} />
      <RelationshipList title="Incoming" items={entity.incoming} />
      <section className="evidence-panel">
        <h3>Evidence</h3>
        {entity.evidence.map((item) => (
          <div key={item.id}>
            <strong>
              {item.derivation} · {Math.round(item.confidence * 100)}%
            </strong>
            <span>{item.statement}</span>
            <small>
              {item.extractorId} {item.extractorVersion}
            </small>
          </div>
        ))}
      </section>
      {entity.diagnostics.length > 0 && (
        <section className="evidence-panel">
          <h3>Diagnostics</h3>
          {entity.diagnostics.map((item) => (
            <div key={item.id ?? `${item.code}-${item.message}`}>
              <strong>{item.code}</strong>
              <span>{item.message}</span>
            </div>
          ))}
        </section>
      )}
      {neighborhood && (
        <section className="scoped-neighborhood">
          <h3>Scoped neighborhood</h3>
          <p>
            {neighborhood.nodes.length} nodes · {neighborhood.relationships.length} relationships
            {neighborhood.truncated ? " · bounded" : ""}
          </p>
          <ul>
            {neighborhood.relationships.slice(0, 30).map((item) => (
              <li key={item.id}>
                <span>{shortId(item.sourceId)}</span>
                <strong>{displayType(item.type)}</strong>
                <span>{shortId(item.targetId)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <CodeAnalysis bridge={bridge} entity={entity} onError={onError} />
    </article>
  );
}

function RelationshipList({
  title,
  items,
}: {
  title: string;
  items: IntelligenceEntityDetails["incoming"];
}): React.JSX.Element {
  return (
    <section className="relationship-list">
      <h3>
        {title} <span>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p>None.</p>
      ) : (
        items.map((item) => (
          <div key={item.id}>
            <strong>{displayType(item.type)}</strong>
            <span>{item.entityName}</span>
            <small>
              {item.derivation} · {Math.round(item.confidence * 100)}%
            </small>
          </div>
        ))
      )}
    </section>
  );
}

function displayType(value: string): string {
  return value.replace(/^keystone\.core\./, "").replace(/_/g, " ");
}
function shortId(value: string): string {
  return value.split(":").at(-1)?.slice(0, 8) ?? value;
}
function showError(setError: (value: string) => void): (cause: unknown) => void {
  return (cause) => setError(cause instanceof Error ? cause.message : String(cause));
}
