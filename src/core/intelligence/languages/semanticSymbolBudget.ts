/**
 * Bound language-service requests per document. Language servers can perform
 * expensive cross-workspace work for each queried symbol, so this is a safety
 * boundary rather than a completeness claim.
 */
export const MAX_LANGUAGE_SERVICE_SYMBOLS_PER_DOCUMENT = 96;

export function boundSemanticSymbols<T>(
  symbols: readonly T[],
  limit = MAX_LANGUAGE_SERVICE_SYMBOLS_PER_DOCUMENT
): { readonly symbols: readonly T[]; readonly truncated: number } {
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    symbols: symbols.slice(0, safeLimit),
    truncated: Math.max(0, symbols.length - safeLimit)
  };
}
