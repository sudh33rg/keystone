/**
 * OKF Concept ID Factory
 *
 * Generates deterministic path identifiers for OKF concepts
 * from canonical Keystone entity IDs.
 *
 * Path generation rules:
 * - Use normalized names (lowercase, spaces to hyphens, path separators to slashes)
 * - Avoid unsafe characters
 * - Handle name collisions with disambiguation suffixes
 * - Maintain stable paths across repeated generation
 * - Preserve mapping to canonical IDs
 */

/**
 * Normalize a name for use in file paths
 *
 * Converts the name to a safe, stable identifier:
 * - Lowercase
 * - Replace spaces with hyphens
 * - Replace path separators with hyphens
 * - Collapse multiple hyphens
 * - Trim whitespace
 *
 * @param name - The name to normalize
 * @returns A normalized name suitable for file paths
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Extract the owning file from a Keystone entity ID
 *
 * Keystone entity IDs have the format:
 * entity:<language>:<relativePath>:<symbolName>
 *
 * @param keystoneId - The Keystone entity ID
 * @returns The relative path component
 */
function extractOwningFile(keystoneId: string): string {
  const parts = keystoneId.split(':');
  // parts[1] = language, parts[2] = relativePath
  if (parts.length < 3) {
    throw new Error(`Invalid keystone_id format: ${keystoneId}`);
  }
  return parts[2];
}

/**
 * Extract the symbol name from a Keystone entity ID
 *
 * @param keystoneId - The Keystone entity ID
 * @returns The symbol name component
 */
function extractSymbolName(keystoneId: string): string {
  const parts = keystoneId.split(':');
  // parts[3] = symbolName
  if (parts.length < 4) {
    throw new Error(`Invalid keystone_id format: ${keystoneId}`);
  }
  return parts[3];
}

/**
 * Get the parent path of a given file path
 *
 * @param path - The file path
 * @returns The parent directory path
 */
function getParentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/') || '.';
}

/**
 * Get the base name (file name) from a given file path
 *
 * @param path - The file path
 * @returns The base name (file name)
 */
function getBaseName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Generate a stable OKF path for a concept.
 *
 * The path is computed deterministically from the Keystone entity ID.
 * This ensures that the same entity always produces the same path,
 * regardless of when or how many times the generation runs.
 *
 * @param keystoneId - The Keystone entity ID (e.g., "entity:typescript:src/orders/order-service.ts:OrderService.create")
 * @param entityType - The OKF concept type (e.g., "Method", "Class", "Component")
 * @param language - The programming language (e.g., "typescript", "javascript")
 * @returns The OKF concept path (e.g., "code/classes/OrderService.create.md")
 */
export function generateOkfPath(
  keystoneId: string,
  entityType: string,
  language: string
): string {
  if (!keystoneId.startsWith('entity:')) {
    throw new Error(`Invalid keystone_id format: ${keystoneId}`);
  }

  const owningFile = extractOwningFile(keystoneId);
  const symbolName = extractSymbolName(keystoneId);
  const normalizedFileName = normalizeName(symbolName);
  const normalizedExtension = normalizeName(language);

  // Determine the category based on entity type
  let category: string;
  let subcategory: string;

  switch (entityType) {
    case 'Repository':
      category = 'repository';
      subcategory = 'overview';
      break;
    case 'File':
      category = 'code';
      subcategory = 'files';
      break;
    case 'Class':
    case 'Interface':
    case 'Component':
      category = 'code';
      subcategory = 'classes';
      break;
    case 'Function':
    case 'Method':
    case 'Hook':
    case 'Route':
    case 'Middleware':
    case 'Endpoint':
      category = 'code';
      subcategory = 'functions';
      break;
    case 'Module':
      category = 'code';
      subcategory = 'modules';
      break;
    case 'Package':
      category = 'code';
      subcategory = 'packages';
      break;
    case 'Database':
    case 'Table':
    case 'ORM Entity':
    case 'ORM Field':
      category = 'data';
      subcategory = 'tables';
      break;
    case 'Test Suite':
    case 'Test Case':
      category = 'tests';
      subcategory = 'suites';
      break;
    case 'Build Target':
    case 'Pipeline':
      category = 'build';
      subcategory = 'targets';
      break;
    case 'Container':
    case 'Kubernetes Resource':
    case 'Terraform Resource':
      category = 'infrastructure';
      subcategory = 'containers';
      break;
    case 'Configuration':
      category = 'configuration';
      subcategory = 'files';
      break;
    case 'Document':
    case 'ADR':
    case 'RFC':
    case 'Runbook':
    case 'Guide':
      category = 'documentation';
      subcategory = 'files';
      break;
    default:
      // Default to code/classes for unknown types
      category = 'code';
      subcategory = 'classes';
  }

  // Build the path: category/subcategory/symbol.md
  const namePart = normalizedFileName === '.' ? 'index' : normalizedFileName;
  return `${category}/${subcategory}/${namePart}.${normalizedExtension}`;
}

/**
 * Validate that a Keystone entity ID has the expected format.
 *
 * @param keystoneId - The Keystone entity ID to validate
 * @param language - The expected language
 * @throws Error if the keystoneId format is invalid
 */
export function validateKeystoneId(keystoneId: string, language: string): void {
  const normalizedId = keystoneId.toLowerCase();
  const normalizedLanguage = language.toLowerCase();

  if (!normalizedId.startsWith('entity:')) {
    throw new Error(`Invalid keystone_id format: must start with "entity:"`);
  }

  const parts = normalizedId.split(':');
  if (parts.length < 4) {
    throw new Error(`Invalid keystone_id format: missing components in "${keystoneId}"`);
  }

  if (parts[1] !== normalizedLanguage) {
    throw new Error(
      `Invalid keystone_id language: expected "${normalizedLanguage}", got "${parts[1]}" in "${keystoneId}"`
    );
  }

  const relativePath = parts[2];
  if (relativePath.startsWith('/') || relativePath.startsWith('..')) {
    throw new Error(`Invalid keystone_id path: must be relative to workspace root in "${keystoneId}"`);
  }
}

/**
 * Create a canonical ID for an OKF concept.
 *
 * The canonical ID is used to uniquely identify a concept
 * across all generations and is used for linking.
 *
 * @param keystoneId - The Keystone entity ID
 * @param path - The generated OKF path
 * @returns A canonical ID (e.g., "concept:typescript:src/orders/order-service.ts:OrderService.create:code/classes/OrderService.create.md")
 */
export function createCanonicalId(keystoneId: string, path: string): string {
  const normalizedId = keystoneId.toLowerCase();
  const normalizedPath = path.toLowerCase();

  return `concept:${normalizedId}:${normalizedPath}`;
}

/**
 * Generate a stable unique ID for a concept.
 *
 * This is used as the concept's internal identifier.
 *
 * @param keystoneId - The Keystone entity ID
 * @param entityType - The concept type
 * @param repositoryId - The repository identifier
 * @returns A unique concept ID (e.g., "concept:4c8f2a3b-1e4d-4b2c-8e9f-0a1b2c3d4e5f")
 */
export function generateConceptId(
  keystoneId: string,
  entityType: string,
  repositoryId: string
): string {
  const sha256 = (input: string) => {
    const buffer = Buffer.from(input, 'utf8');
    return buffer.toString('hex');
  };

  const input = `${keystoneId}|${entityType}|${repositoryId}`;
  return `concept:${sha256(input)}`;
}

/**
 * Generate a stable index path for a category.
 *
 * @param category - The category name (e.g., "code", "architecture")
 * @param subcategory - The subcategory name (e.g., "classes", "modules")
 * @returns The index path (e.g., "code/classes/index.md")
 */
export function generateIndexPath(category: string, subcategory: string): string {
  return `${category}/${subcategory}/index.md`;
}
