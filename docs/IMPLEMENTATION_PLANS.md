# Keystone Implementation Plans for Identified Gaps

**Date**: 2025-08-01  
**Based on**: GAP_ANALYSIS.md

---

## Overview

This document provides detailed implementation plans for the 4 critical gaps and 3 minor gaps identified in the gap analysis. Each plan includes:

- Technical approach
- Files to modify
- New files to create
- Testing strategy
- Estimated effort

---

## Critical Gap 1: Continuation Packets

### Problem

Large contexts exceeding token budgets cannot be delivered to Copilot in chunks. The `buildContextPacket` function creates a single `ContextPacket` with no packet splitting logic.

### Technical Approach

1. **Extend `ContextPacket` type** in `src/core/domain/types.ts` to support continuation metadata
2. **Add packet splitting logic** in `src/core/context/intentContextBuilder.ts`
3. **Update webview message handlers** to support multi-packet delivery
4. **Add packet assembly logic** on the client side (webview)

### Files to Modify

#### 1. `src/core/domain/types.ts`

```typescript
// Add to ContextPacket interface
export interface ContextPacket {
  // ... existing fields ...

  // NEW: Continuation support
  continuation?: {
    sequenceNumber: number; // 1-based index
    totalPackets: number; // Total packets in this context
    continuationToken: string; // Opaque token for next packet request
    isFinal: boolean; // True for last packet
  };
}
```

#### 2. `src/core/context/intentContextBuilder.ts`

- Add `splitIntoPackets(packet: ContextPacket, maxTokensPerPacket: number): ContextPacket[]` function
- Modify `buildContextPacket` to return `ContextPacket[]` when `deliveryMode === 'adaptive-segments'` or when packet exceeds token budget
- Implement packet sequencing with continuation tokens

#### 3. `src/extension/ui/vscodeProvider.ts`

- Update `handleBuildContextPacket` to support multi-packet responses
- Send packets sequentially with continuation tokens

#### 4. `src/webview/App.tsx`

- Add packet assembly state
- Handle `CONTEXT_PACKET` message with continuation support
- Request next packet using continuation token

### New Files

- `src/core/context/packetSplitter.ts` - Core packet splitting logic
- `src/core/context/packetSplitter.test.ts` - Unit tests

### Testing Strategy

- Unit tests for packet splitting with various token budgets
- Integration test: large repository context > 100k tokens
- Webview test: verify packet assembly and display
- Edge case: single packet (no continuation needed)

### Estimated Effort: 2-3 days

---

## Critical Gap 2: Context Compression Caching

### Problem

Every call to `buildContextPacket` recomputes intent classification, evidence gathering, deduplication, ranking, structural compression, and token budgeting. No caching layer exists.

### Technical Approach

1. **Create cache infrastructure** in `src/core/platform/storage/` or new `src/core/context/cache/`
2. **Implement cache key generation** based on intent + file hashes + compression tier
3. **Add cache layer** in `intentContextBuilder.ts`
4. **Integrate with file watcher** for invalidation
5. **Add TTL and size limits**

### Files to Modify

#### 1. `src/core/context/intentContextBuilder.ts`

- Add `ContextCompressionCache` class or use existing storage
- Modify `buildContextPacket` to check cache first
- Cache key: `hash(intent + sortedFileHashes + compressionTier)`
- On cache miss: compute, store, return
- On cache hit: return cached packet

#### 2. `src/core/platform/storage/jsonStorage.ts` (or new cache storage)

- Add `CacheEntry<T>` interface with `value`, `timestamp`, `ttl`
- Add `getWithTTL(key)`, `setWithTTL(key, value, ttl)` methods

#### 3. `src/extension/core/extension.ts` (file watcher)

- On file change: invalidate affected cache entries
- Track file-to-cache-key mapping for efficient invalidation

### New Files

- `src/core/context/contextCompressionCache.ts` - Cache implementation
- `src/core/context/contextCompressionCache.test.ts` - Unit tests

### Cache Invalidation Strategy

- **Primary**: File content hash change → invalidate all cache entries containing that file
- **Secondary**: TTL expiration (default: 1 hour)
- **Tertiary**: Manual cache clear command

### Testing Strategy

- Unit tests: cache hit/miss, TTL expiration, invalidation
- Performance test: measure speedup on repeated context requests
- Integration test: file modification triggers cache invalidation

### Estimated Effort: 2-3 days

---

## Critical Gap 3: Query Result Caching (TTL-based)

### Problem

Repeated identical queries re-execute full graph traversal in `queryEngine.ts` and `intelligenceExplorer.ts`.

### Technical Approach

1. **Add query cache** in `src/core/intelligence/okf/queryEngine.ts`
2. **Cache key**: normalized query + snapshot digest
3. **TTL-based expiration** (configurable, default 5 minutes)
4. **Invalidate on snapshot promotion**

### Files to Modify

#### 1. `src/core/intelligence/okf/queryEngine.ts`

```typescript
// Add to QueryEngine class
private queryCache: Map<string, { result: QueryResult; timestamp: number; ttl: number }> = new Map();

async executeQuery(query: string, options?: QueryOptions): Promise<QueryResult> {
  const cacheKey = this.generateCacheKey(query, options);
  const cached = this.queryCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    this.metrics.recordCacheHit();
    return cached.result;
  }

  const result = await this.executeQueryInternal(query, options);
  this.queryCache.set(cacheKey, { result, timestamp: Date.now(), ttl: this.config.queryCacheTtl });
  return result;
}

private generateCacheKey(query: string, options?: QueryOptions): string {
  const snapshotDigest = this.okfStore.getCurrentSnapshotDigest();
  return `${snapshotDigest}:${query}:${JSON.stringify(options || {})}`;
}
```

#### 2. `src/core/intelligence/okf/store.ts`

- Add `getCurrentSnapshotDigest()` method
- Emit event on snapshot promotion for cache invalidation

#### 3. `src/core/intelligence/explorer/intelligenceExplorer.ts`

- Use `QueryEngine` cache (already uses QueryEngine internally)

### Configuration

Add to `src/core/platform/config/qualityConfig.ts`:

```typescript
queryCacheTtl: 300000, // 5 minutes in ms
queryCacheMaxSize: 1000,
```

### Testing Strategy

- Unit tests: cache hit/miss, TTL, snapshot invalidation
- Integration test: repeated queries return cached results
- Performance test: query latency with/without cache

### Estimated Effort: 1-2 days

---

## Critical Gap 4: "adaptive-segments" Delivery Mode

### Problem

The `ContextDeliveryMode` type includes `'adaptive-segments'` but `buildContextPacket` doesn't handle it.

### Technical Approach

1. **Implement adaptive segments logic** in `intentContextBuilder.ts`
2. **Return progressive segments**: summary → key sections → full detail
3. **Add segment metadata** for client-side assembly
4. **Update webview** to request and render adaptive segments

### Files to Modify

#### 1. `src/core/context/intentContextBuilder.ts`

```typescript
// In buildContextPacket function
case 'adaptive-segments':
  return this.buildAdaptiveSegments(intent, evidence, options);

private buildAdaptiveSegments(...): ContextPacket[] {
  // Segment 1: Summary + high-level structure (500 tokens)
  // Segment 2: Key files + critical paths (2000 tokens)
  // Segment 3: Full detail (remaining budget)
  // Each segment is a ContextPacket with continuation metadata
}
```

#### 2. `src/core/domain/types.ts`

- Ensure `ContextPacket.continuation` supports adaptive segments (from Gap 1)

#### 3. `src/extension/ui/vscodeProvider.ts`

- Handle `'adaptive-segments'` in message handler
- Send segments progressively

#### 4. `src/webview/App.tsx`

- Add adaptive segments UI state
- Render segments progressively
- "Load more" button for next segment

### Testing Strategy

- Unit test: adaptive segments generation with correct token budgets
- Integration test: webview renders segments progressively
- UX test: verify progressive loading improves perceived performance

### Estimated Effort: 1-2 days

---

## Minor Gap 5: File Hash Cache Persistence

### Problem

File hashes recomputed on every startup; no persistent cache file.

### Technical Approach

1. **Persist hash cache** to `.keystone/cache/hashes.json`
2. **Load on startup** in `repoIndexer.ts`
3. **Invalidate on file modification**

### Files to Modify

#### 1. `src/core/intelligence/ingestion/repoIndexer.ts`

- Add `loadHashCache()` and `saveHashCache()` methods
- Call `loadHashCache()` in `initialize()`
- Call `saveHashCache()` after indexing batch
- Use `JsonStorage` for persistence

#### 2. `src/core/platform/storage/jsonStorage.ts`

- Already supports JSON persistence - reuse

### Cache Format

```json
{
  "version": 1,
  "entries": {
    "src/file.ts": {
      "contentHash": "sha256:...",
      "structureHash": "sha256:...",
      "size": 1234,
      "mtime": 1234567890
    }
  }
}
```

### Testing Strategy

- Unit test: cache load/save
- Integration test: startup loads cache, file change invalidates
- Performance test: startup time with/without cache

### Estimated Effort: 1 day

---

## Minor Gap 6: Extraction Result Cache Persistence

### Problem

No separate extraction result cache for reuse across runs; extractor version checking not implemented.

### Technical Approach

1. **Persist extraction cache** to `.keystone/cache/extractions/`
2. **Key by** `{ fileHash, extractorName, extractorVersion }`
3. **Version-aware invalidation**

### Files to Modify

#### 1. `src/core/intelligence/ingestion/repoIndexer.ts`

- Add extraction cache loading/saving
- Check extractor version before using cached result
- Store extraction results with version metadata

### Cache Structure

```
.keystone/cache/extractions/
├── typescript-compiler@4.9.5/
│   ├── sha256:abc123...json
│   └── sha256:def456...json
└── java-compiler@1.2.0/
    └── sha256:ghi789...json
```

### Testing Strategy

- Unit test: version-aware cache hit/miss
- Integration test: extractor upgrade invalidates cache
- Performance test: re-indexing speed with cache

### Estimated Effort: 2 days

---

## Minor Gap 7: Projection Cache In-Memory

### Problem

No in-memory cache layer for hot projections; always loads from disk.

### Technical Approach

1. **Add in-memory cache** in `OkfStore` or `DerivedGraph`
2. **Validate against snapshot digest** on access
3. **Lazy loading with cache warming**

### Files to Modify

#### 1. `src/core/intelligence/okf/store.ts`

```typescript
private projectionCache: Map<string, { data: any; snapshotDigest: string }> = new Map();

async getProjection(name: string): Promise<any> {
  const currentDigest = this.getCurrentSnapshotDigest();
  const cached = this.projectionCache.get(name);

  if (cached && cached.snapshotDigest === currentDigest) {
    return cached.data;
  }

  const data = await this.loadProjectionFromDisk(name);
  this.projectionCache.set(name, { data, snapshotDigest: currentDigest });
  return data;
}
```

#### 2. `src/core/intelligence/pipeline/derivedGraph.ts`

- Use `OkfStore` projection cache

### Testing Strategy

- Unit test: cache hit/miss, snapshot invalidation
- Performance test: projection access latency

### Estimated Effort: 1 day

---

## Implementation Priority Order

| Order | Gap                                 | Priority | Effort   | Dependencies         |
| ----- | ----------------------------------- | -------- | -------- | -------------------- |
| 1     | Query Result Caching                | P0       | 1-2 days | None                 |
| 2     | adaptive-segments Delivery          | P0       | 1-2 days | Gap 1 (types)        |
| 3     | Continuation Packets                | P0       | 2-3 days | Gap 2 (types)        |
| 4     | Context Compression Caching         | P0       | 2-3 days | Cache infrastructure |
| 5     | File Hash Cache Persistence         | P1       | 1 day    | None                 |
| 6     | Projection Cache In-Memory          | P1       | 1 day    | None                 |
| 7     | Extraction Result Cache Persistence | P1       | 2 days   | Gap 5                |

---

## Cross-Cutting Concerns

### Cache Infrastructure

Consider creating a shared cache module:

- `src/core/platform/cache/` with:
  - `Cache<T>` interface
  - `InMemoryCache<T>` implementation
  - `PersistentCache<T>` implementation (wraps JsonStorage)
  - `TTLCache<T>` decorator
  - `CacheManager` for multi-cache coordination

### Metrics

Add cache metrics to `src/core/platform/metrics/metricsStore.ts`:

- `cache.hit`, `cache.miss`, `cache.invalidation`, `cache.size`

### Configuration

Add cache configuration to `src/core/platform/config/qualityConfig.ts`:

```typescript
caches: {
  query: { ttl: 300000, maxSize: 1000 },
  contextCompression: { ttl: 3600000, maxSize: 500 },
  fileHash: { persistent: true },
  extraction: { persistent: true },
  projection: { inMemory: true }
}
```

---

## Testing Infrastructure

### New Test Files Needed

- `src/core/context/packetSplitter.test.ts`
- `src/core/context/contextCompressionCache.test.ts`
- `src/core/intelligence/okf/queryEngine.cache.test.ts`
- `src/core/intelligence/ingestion/repoIndexer.cache.test.ts`
- `src/core/intelligence/okf/store.projectionCache.test.ts`

### Test Commands

Add to `package.json`:

```json
"test:cache": "vitest run **/*.cache.test.ts",
"test:packets": "vitest run **/packetSplitter.test.ts"
```

---

## Documentation Updates Required

After implementation, update:

1. `docs/ARCHITECTURE.md` - Mark caching features as implemented
2. `docs/PRODUCT_PLAN_CONFORMANCE.md` - Update acceptance evidence
3. `docs/GAP_ANALYSIS.md` - Mark gaps as resolved
4. Add cache configuration documentation
