// Ground-truth manifest for full-stack fixture
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
  source: string;
  target: string;
  type: string;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  evidence?: string[];
}

export interface ExpectedUsageQuery {
  entity: string;
  expectedCount: number;
}

export interface ExpectedFlow {
  name: string;
  entities: string[];
}

export interface ExpectedPath {
  name: string;
  source: string;
  target: string;
  edges: string[];
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
  repositoryId: 'fixture-fullstack',

  entities: [
    // UI layer
    {
      kind: 'file',
      name: 'index.tsx',
      qualifiedName: 'fixture-fullstack/ui/src/index.tsx',
      filePath: 'ui/src/index.tsx',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { language: 'tsx', entry: true },
    },
    {
      kind: 'route',
      name: 'CheckoutPage route',
      qualifiedName: 'fixture-fullstack/ui/src/routes.tsx:CheckoutPage',
      filePath: 'ui/src/routes.tsx',
      startLine: 1,
      endLine: 5,
      confidence: 'exact',
      metadata: { component: 'CheckoutPage' },
    },
    {
      kind: 'component',
      name: 'CheckoutPage',
      qualifiedName: 'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
      filePath: 'ui/src/pages/CheckoutPage.tsx',
      startLine: 1,
      endLine: 30,
      confidence: 'exact',
      metadata: { props: ['cartItems', 'onOrderComplete'] },
    },
    {
      kind: 'function',
      name: 'createCheckout',
      qualifiedName: 'fixture-fullstack/ui/src/api/checkoutApi.ts:createCheckout',
      filePath: 'ui/src/api/checkoutApi.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { httpMethod: 'POST', url: '/checkout' },
    },
    {
      kind: 'test',
      name: 'CheckoutPage.test.tsx',
      qualifiedName: 'fixture-fullstack/ui/tests/unit/CheckoutPage.test.tsx',
      filePath: 'ui/tests/unit/CheckoutPage.test.tsx',
      startLine: 1,
      endLine: 30,
      confidence: 'exact',
      metadata: { target: 'CheckoutPage' },
    },
    // Server layer
    {
      kind: 'file',
      name: 'index.ts',
      qualifiedName: 'fixture-fullstack/server/src/index.ts',
      filePath: 'server/src/index.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { language: 'typescript', entry: true },
    },
    {
      kind: 'route',
      name: 'POST /checkout',
      qualifiedName: 'fixture-fullstack/server/src/routes/checkout.ts:POST /checkout',
      filePath: 'server/src/routes/checkout.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { method: 'POST', path: '/checkout' },
    },
    {
      kind: 'class',
      name: 'CheckoutController',
      qualifiedName: 'fixture-fullstack/server/src/controllers/CheckoutController.ts:CheckoutController',
      filePath: 'server/src/controllers/CheckoutController.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { methods: ['process'] },
    },
    {
      kind: 'class',
      name: 'CheckoutService',
      qualifiedName: 'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService',
      filePath: 'server/src/services/CheckoutService.ts',
      startLine: 1,
      endLine: 40,
      confidence: 'exact',
      metadata: { methods: ['process'], dependsOn: ['OrderRepository', 'PaymentGateway', 'NotificationConsumer'] },
    },
    {
      kind: 'class',
      name: 'PaymentGateway',
      qualifiedName: 'fixture-fullstack/server/src/services/PaymentGateway.ts:PaymentGateway',
      filePath: 'server/src/services/PaymentGateway.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { methods: ['charge'] },
    },
    {
      kind: 'class',
      name: 'OrderRepository',
      qualifiedName: 'fixture-fullstack/server/src/repositories/OrderRepository.ts:OrderRepository',
      filePath: 'server/src/repositories/OrderRepository.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { methods: ['save', 'find'] },
    },
    {
      kind: 'class',
      name: 'Order',
      qualifiedName: 'fixture-fullstack/server/src/models/Order.entity.ts:Order',
      filePath: 'server/src/models/Order.entity.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { table: 'orders' },
    },
    {
      kind: 'class',
      name: 'EventBus',
      qualifiedName: 'fixture-fullstack/server/src/events/EventBus.ts:EventBus',
      filePath: 'server/src/events/EventBus.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { events: ['order-created'] },
    },
    {
      kind: 'class',
      name: 'NotificationConsumer',
      qualifiedName: 'fixture-fullstack/server/src/events/NotificationConsumer.ts:NotificationConsumer',
      filePath: 'server/src/events/NotificationConsumer.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { subscribesTo: ['order-created'] },
    },
    {
      kind: 'test',
      name: 'checkout.test.ts',
      qualifiedName: 'fixture-fullstack/server/tests/integration/checkout.test.ts',
      filePath: 'server/tests/integration/checkout.test.ts',
      startLine: 1,
      endLine: 30,
      confidence: 'exact',
      metadata: { target: 'POST /checkout' },
    },
  ],

  relationships: [
    // UI → API
    {
      source: 'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
      target: 'fixture-fullstack/ui/src/api/checkoutApi.ts:createCheckout',
      type: 'calls',
      confidence: 'exact',
      evidence: ['ui/src/pages/CheckoutPage.tsx:12'],
    },
    // API → backend route
    {
      source: 'fixture-fullstack/ui/src/api/checkoutApi.ts:createCheckout',
      target: 'fixture-fullstack/server/src/routes/checkout.ts:POST /checkout',
      type: 'calls',
      confidence: 'high',
      evidence: ['ui/src/api/checkoutApi.ts:4'],
      metadata: { crossBoundary: 'frontend→backend' },
    },
    // Route → controller
    {
      source: 'fixture-fullstack/server/src/routes/checkout.ts:POST /checkout',
      target: 'fixture-fullstack/server/src/controllers/CheckoutController.ts:CheckoutController.process',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/routes/checkout.ts:4'],
    },
    // Controller → service
    {
      source: 'fixture-fullstack/server/src/controllers/CheckoutController.ts:CheckoutController.process',
      target: 'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService.process',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/controllers/CheckoutController.ts:5'],
    },
    // Service → payment gateway
    {
      source: 'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService.process',
      target: 'fixture-fullstack/server/src/services/PaymentGateway.ts:PaymentGateway.charge',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/services/CheckoutService.ts:15'],
    },
    // Service → repository
    {
      source: 'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService.process',
      target: 'fixture-fullstack/server/src/repositories/OrderRepository.ts:OrderRepository.save',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/services/CheckoutService.ts:28'],
    },
    // Service → event bus
    {
      source: 'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService.process',
      target: 'fixture-fullstack/server/src/events/NotificationConsumer.ts:NotificationConsumer.emit',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/services/CheckoutService.ts:30'],
    },
    // Event bus → consumer
    {
      source: 'fixture-fullstack/server/src/events/EventBus.ts:EventBus',
      target: 'fixture-fullstack/server/src/events/NotificationConsumer.ts:NotificationConsumer',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/events/NotificationConsumer.ts:14'],
    },
    // Repository → entity
    {
      source: 'fixture-fullstack/server/src/repositories/OrderRepository.ts:OrderRepository.save',
      target: 'fixture-fullstack/server/src/models/Order.entity.ts:Order',
      type: 'calls',
      confidence: 'exact',
      evidence: ['server/src/repositories/OrderRepository.ts:6'],
    },
    // Tests
    {
      source: 'fixture-fullstack/ui/tests/unit/CheckoutPage.test.tsx',
      target: 'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
      type: 'covers',
      confidence: 'exact',
      evidence: ['ui/tests/unit/CheckoutPage.test.tsx'],
    },
    {
      source: 'fixture-fullstack/server/tests/integration/checkout.test.ts',
      target: 'fixture-fullstack/server/src/routes/checkout.ts',
      type: 'covers',
      confidence: 'exact',
      evidence: ['server/tests/integration/checkout.test.ts'],
    },
  ],

  usages: [
    { entity: 'PaymentGateway.charge', expectedCount: 1 },
    { entity: 'OrderRepository.save', expectedCount: 1 },
    { entity: 'NotificationConsumer.emit', expectedCount: 1 },
  ],

  flows: [
    {
      name: 'checkout',
      entities: [
        'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
        'fixture-fullstack/ui/src/api/checkoutApi.ts:createCheckout',
        'fixture-fullstack/server/src/routes/checkout.ts:POST /checkout',
        'fixture-fullstack/server/src/controllers/CheckoutController.ts:CheckoutController.process',
        'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService.process',
        'fixture-fullstack/server/src/services/PaymentGateway.ts:PaymentGateway.charge',
        'fixture-fullstack/server/src/repositories/OrderRepository.ts:OrderRepository.save',
        'fixture-fullstack/server/src/models/Order.entity.ts:Order',
        'fixture-fullstack/server/src/events/NotificationConsumer.ts:NotificationConsumer.emit',
      ],
    },
  ],

  paths: [
    {
      name: 'ui-to-event',
      source: 'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
      target: 'fixture-fullstack/server/src/events/NotificationConsumer.ts:NotificationConsumer.emit',
      edges: ['calls', 'calls', 'calls', 'calls', 'calls', 'calls'],
    },
  ],

  impacts: [
    {
      entity: 'fixture-fullstack/server/src/models/Order.entity.ts:Order',
      directDependents: ['fixture-fullstack/server/src/repositories/OrderRepository.ts:OrderRepository.save'],
      transitiveDependents: [
        'fixture-fullstack/server/src/services/CheckoutService.ts:CheckoutService.process',
        'fixture-fullstack/server/src/controllers/CheckoutController.ts:CheckoutController.process',
        'fixture-fullstack/server/src/routes/checkout.ts:POST /checkout',
        'fixture-fullstack/ui/src/api/checkoutApi.ts:createCheckout',
        'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
      ],
    },
  ],

  tests: [
    {
      testPath: 'fixture-fullstack/ui/tests/unit/CheckoutPage.test.tsx',
      targetEntity: 'fixture-fullstack/ui/src/pages/CheckoutPage.tsx:CheckoutPage',
      coverage: 'direct',
    },
    {
      testPath: 'fixture-fullstack/server/tests/integration/checkout.test.ts',
      targetEntity: 'fixture-fullstack/server/src/routes/checkout.ts',
      coverage: 'direct',
    },
  ],

  unresolved: [],
};
