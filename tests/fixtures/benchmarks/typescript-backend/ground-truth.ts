// Ground-truth manifest for TypeScript backend fixture
// DO NOT use in runtime Intelligence — evaluation tests only.

export interface ExpectedEntity {
  kind: string;
  name: string;
  qualifiedName?: string;
  filePath: string;
  startLine: number;
  endLine: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
}

export interface ExpectedRelationship {
  source: string; // entity ID or qualifiedName
  target: string;
  type: string; // calls | imports | contains | declares | covers | owns
  confidence: 'exact' | 'high' | 'medium' | 'low';
  evidence?: string[];
}

export interface ExpectedUsageQuery {
  entity: string;
  expectedCount: number;
}

export interface ExpectedFlow {
  name: string;
  entities: string[]; // ordered list of entity IDs
}

export interface ExpectedPath {
  name: string;
  source: string;
  target: string;
  edges: string[]; // edge type labels
}

export interface ExpectedImpact {
  entity: string;
  directDependents: string[];
  transitiveDependents: string[];
}

export interface ExpectedTestMapping {
  testPath: string;
  targetEntity: string;
  coverage: 'direct' | 'indirect' | 'none';
}

export interface ExpectedUnresolvedRelationship {
  source: string;
  target: string;
  type: string;
  reason: string;
}

export interface IntelligenceGroundTruth {
  repositoryId: string;
  entities: ExpectedEntity[];
  relationships: ExpectedRelationship[];
  usages: ExpectedUsageQuery[];
  flows: ExpectedFlow[];
  paths: ExpectedPath[];
  impacts: ExpectedImpact[];
  tests: ExpectedTestMapping[];
  unresolved: ExpectedUnresolvedRelationship[];
}

export const groundTruth: IntelligenceGroundTruth = {
  repositoryId: 'fixture-typescript-backend',

  entities: [
    // Config
    {
      kind: 'file',
      name: 'database.ts',
      qualifiedName: 'fixture-typescript-backend/src/config/database.ts',
      filePath: 'src/config/database.ts',
      startLine: 1,
      endLine: 12,
      confidence: 'exact',
      metadata: { language: 'typescript' },
    },
    // Interfaces
    {
      kind: 'interface',
      name: 'Order',
      qualifiedName: 'fixture-typescript-backend/src/interfaces/order.interface.ts:Order',
      filePath: 'src/interfaces/order.interface.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { properties: ['id', 'customerId', 'items', 'total', 'status', 'createdAt'] },
    },
    // Models
    {
      kind: 'class',
      name: 'Order',
      qualifiedName: 'fixture-typescript-backend/src/models/order.entity.ts:Order',
      filePath: 'src/models/order.entity.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { implements: ['Order'] },
    },
    // Repositories
    {
      kind: 'class',
      name: 'OrderRepository',
      qualifiedName: 'fixture-typescript-backend/src/repositories/OrderRepository.ts:OrderRepository',
      filePath: 'src/repositories/OrderRepository.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { methods: ['save', 'find'] },
    },
    // Services
    {
      kind: 'class',
      name: 'OrderService',
      qualifiedName: 'fixture-typescript-backend/src/services/OrderService.ts:OrderService',
      filePath: 'src/services/OrderService.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { methods: ['create', 'find'], dependsOn: ['OrderRepository'] },
    },
    // Controllers
    {
      kind: 'class',
      name: 'OrderController',
      qualifiedName: 'fixture-typescript-backend/src/controllers/OrderController.ts:OrderController',
      filePath: 'src/controllers/OrderController.ts',
      startLine: 1,
      endLine: 18,
      confidence: 'exact',
      metadata: { methods: ['create'], dependsOn: ['OrderService'] },
    },
    // Middleware
    {
      kind: 'function',
      name: 'authentication',
      qualifiedName: 'fixture-typescript-backend/src/middleware/authentication.ts:authentication',
      filePath: 'src/middleware/authentication.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { type: 'middleware' },
    },
    // Routes
    {
      kind: 'route',
      name: 'POST /orders',
      qualifiedName: 'fixture-typescript-backend/src/routes/orders.ts:POST /orders',
      filePath: 'src/routes/orders.ts',
      startLine: 1,
      endLine: 8,
      confidence: 'exact',
      metadata: { method: 'POST', path: '/orders' },
    },
    // Entry
    {
      kind: 'file',
      name: 'index.ts',
      qualifiedName: 'fixture-typescript-backend/src/index.ts',
      filePath: 'src/index.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { language: 'typescript', entry: true },
    },
    // Tests
    {
      kind: 'test',
      name: 'order.service.test.ts',
      qualifiedName: 'fixture-typescript-backend/tests/unit/order.service.test.ts',
      filePath: 'tests/unit/order.service.test.ts',
      startLine: 1,
      endLine: 30,
      confidence: 'exact',
      metadata: { target: 'OrderService' },
    },
    {
      kind: 'test',
      name: 'orders.test.ts',
      qualifiedName: 'fixture-typescript-backend/tests/integration/orders.test.ts',
      filePath: 'tests/integration/orders.test.ts',
      startLine: 1,
      endLine: 30,
      confidence: 'exact',
      metadata: { target: 'POST /orders' },
    },
  ],

  relationships: [
    // Route → middleware → controller
    {
      source: 'fixture-typescript-backend/src/routes/orders.ts:POST /orders',
      target: 'fixture-typescript-backend/src/middleware/authentication.ts:authentication',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/routes/orders.ts:6'],
    },
    {
      source: 'fixture-typescript-backend/src/routes/orders.ts:POST /orders',
      target: 'fixture-typescript-backend/src/controllers/OrderController.ts:OrderController.create',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/routes/orders.ts:6'],
    },
    // Controller → service
    {
      source: 'fixture-typescript-backend/src/controllers/OrderController.ts:OrderController.create',
      target: 'fixture-typescript-backend/src/services/OrderService.ts:OrderService.create',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/controllers/OrderController.ts:13'],
    },
    // Service → repository
    {
      source: 'fixture-typescript-backend/src/services/OrderService.ts:OrderService.create',
      target: 'fixture-typescript-backend/src/repositories/OrderRepository.ts:OrderRepository.save',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/services/OrderService.ts:10'],
    },
    // Repository → entity
    {
      source: 'fixture-typescript-backend/src/repositories/OrderRepository.ts:OrderRepository.save',
      target: 'fixture-typescript-backend/src/models/order.entity.ts:Order',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/repositories/OrderRepository.ts:6'],
    },
    // Entity implements interface
    {
      source: 'fixture-typescript-backend/src/models/order.entity.ts:Order',
      target: 'fixture-typescript-backend/src/interfaces/order.interface.ts:Order',
      type: 'implements',
      confidence: 'exact',
      evidence: ['src/models/order.entity.ts:4'],
    },
    // Entry → routes
    {
      source: 'fixture-typescript-backend/src/index.ts',
      target: 'fixture-typescript-backend/src/routes/orders.ts',
      type: 'imports',
      confidence: 'exact',
      evidence: ['src/index.ts:2'],
    },
    // Entry → config
    {
      source: 'fixture-typescript-backend/src/index.ts',
      target: 'fixture-typescript-backend/src/config/database.ts:getDatabaseConfig',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/index.ts:4'],
    },
    // Tests
    {
      source: 'fixture-typescript-backend/tests/unit/order.service.test.ts',
      target: 'fixture-typescript-backend/src/services/OrderService.ts:OrderService',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/unit/order.service.test.ts'],
    },
    {
      source: 'fixture-typescript-backend/tests/integration/orders.test.ts',
      target: 'fixture-typescript-backend/src/routes/orders.ts',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/integration/orders.test.ts'],
    },
  ],

  usages: [
    { entity: 'OrderRepository.save', expectedCount: 1 },
    { entity: 'OrderService.create', expectedCount: 1 },
    { entity: 'OrderController.create', expectedCount: 1 },
  ],

  flows: [
    {
      name: 'POST /orders',
      entities: [
        'fixture-typescript-backend/src/routes/orders.ts:POST /orders',
        'fixture-typescript-backend/src/middleware/authentication.ts:authentication',
        'fixture-typescript-backend/src/controllers/OrderController.ts:OrderController.create',
        'fixture-typescript-backend/src/services/OrderService.ts:OrderService.create',
        'fixture-typescript-backend/src/repositories/OrderRepository.ts:OrderRepository.save',
        'fixture-typescript-backend/src/models/order.entity.ts:Order',
      ],
    },
  ],

  paths: [
    {
      name: 'route-to-repository',
      source: 'fixture-typescript-backend/src/routes/orders.ts:POST /orders',
      target: 'fixture-typescript-backend/src/repositories/OrderRepository.ts:OrderRepository.save',
      edges: ['calls', 'calls', 'calls'],
    },
  ],

  impacts: [
    {
      entity: 'fixture-typescript-backend/src/repositories/OrderRepository.ts:OrderRepository.save',
      directDependents: ['fixture-typescript-backend/src/services/OrderService.ts:OrderService.create'],
      transitiveDependents: [
        'fixture-typescript-backend/src/controllers/OrderController.ts:OrderController.create',
        'fixture-typescript-backend/src/routes/orders.ts:POST /orders',
      ],
    },
  ],

  tests: [
    {
      testPath: 'fixture-typescript-backend/tests/unit/order.service.test.ts',
      targetEntity: 'fixture-typescript-backend/src/services/OrderService.ts:OrderService',
      coverage: 'direct',
    },
    {
      testPath: 'fixture-typescript-backend/tests/integration/orders.test.ts',
      targetEntity: 'fixture-typescript-backend/src/routes/orders.ts',
      coverage: 'direct',
    },
  ],

  unresolved: [
    {
      source: 'fixture-typescript-backend/src/index.ts',
      target: 'plugin-dir/*',
      type: 'calls',
      reason: 'dynamic require with variable path',
    },
  ],
};
