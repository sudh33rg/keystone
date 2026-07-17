// Ground-truth manifest for React frontend fixture
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
  repositoryId: 'fixture-react-frontend',

  entities: [
    {
      kind: 'file',
      name: 'index.tsx',
      qualifiedName: 'fixture-react-frontend/src/index.tsx',
      filePath: 'src/index.tsx',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { language: 'tsx', entry: true },
    },
    {
      kind: 'route',
      name: 'OrdersPage route',
      qualifiedName: 'fixture-react-frontend/src/routes.tsx:OrdersPage',
      filePath: 'src/routes.tsx',
      startLine: 1,
      endLine: 5,
      confidence: 'exact',
      metadata: { component: 'OrdersPage' },
    },
    {
      kind: 'component',
      name: 'OrdersPage',
      qualifiedName: 'fixture-react-frontend/src/pages/OrdersPage.tsx:OrdersPage',
      filePath: 'src/pages/OrdersPage.tsx',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { children: ['CreateOrderButton'] },
    },
    {
      kind: 'component',
      name: 'CreateOrderButton',
      qualifiedName: 'fixture-react-frontend/src/components/CreateOrderButton.tsx:CreateOrderButton',
      filePath: 'src/components/CreateOrderButton.tsx',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { props: ['onClick'] },
    },
    {
      kind: 'hook',
      name: 'useCreateOrder',
      qualifiedName: 'fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder',
      filePath: 'src/hooks/useCreateOrder.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { returns: ['loading', 'execute'] },
    },
    {
      kind: 'function',
      name: 'create',
      qualifiedName: 'fixture-react-frontend/src/api/orderApi.ts:create',
      filePath: 'src/api/orderApi.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { httpMethod: 'POST', url: '/orders' },
    },
    {
      kind: 'component',
      name: 'OrderProvider',
      qualifiedName: 'fixture-react-frontend/src/context/OrderContext.tsx:OrderProvider',
      filePath: 'src/context/OrderContext.tsx',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { provides: ['createOrder'] },
    },
    {
      kind: 'component',
      name: 'OrderConsumer',
      qualifiedName: 'fixture-react-frontend/src/context/OrderConsumer.tsx:OrderConsumer',
      filePath: 'src/context/OrderConsumer.tsx',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { consumes: ['createOrder'] },
    },
    {
      kind: 'test',
      name: 'OrderConsumer.test.tsx',
      qualifiedName: 'fixture-react-frontend/tests/unit/OrderConsumer.test.tsx',
      filePath: 'tests/unit/OrderConsumer.test.tsx',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { target: 'OrderConsumer' },
    },
    {
      kind: 'test',
      name: 'useCreateOrder.test.ts',
      qualifiedName: 'fixture-react-frontend/tests/unit/useCreateOrder.test.ts',
      filePath: 'tests/unit/useCreateOrder.test.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { target: 'useCreateOrder' },
    },
  ],

  relationships: [
    {
      source: 'fixture-react-frontend/src/pages/OrdersPage.tsx:OrdersPage',
      target: 'fixture-react-frontend/src/components/CreateOrderButton.tsx:CreateOrderButton',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/pages/OrdersPage.tsx'],
    },
    {
      source: 'fixture-react-frontend/src/components/CreateOrderButton.tsx:CreateOrderButton',
      target: 'fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/components/CreateOrderButton.tsx'],
    },
    {
      source: 'fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder',
      target: 'fixture-react-frontend/src/api/orderApi.ts:create',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/hooks/useCreateOrder.ts:2'],
    },
    {
      source: 'fixture-react-frontend/src/routes.tsx',
      target: 'fixture-react-frontend/src/pages/OrdersPage.tsx:OrdersPage',
      type: 'imports',
      confidence: 'exact',
      evidence: ['src/routes.tsx'],
    },
    {
      source: 'fixture-react-frontend/src/index.tsx',
      target: 'fixture-react-frontend/src/context/OrderContext.tsx:OrderProvider',
      type: 'imports',
      confidence: 'exact',
      evidence: ['src/index.tsx'],
    },
    {
      source: 'fixture-react-frontend/src/context/OrderConsumer.tsx:OrderConsumer',
      target: 'fixture-react-frontend/src/context/OrderContext.tsx:OrderProvider',
      type: 'calls',
      confidence: 'exact',
      evidence: ['src/context/OrderConsumer.tsx'],
    },
    {
      source: 'fixture-react-frontend/tests/unit/OrderConsumer.test.tsx',
      target: 'fixture-react-frontend/src/context/OrderConsumer.tsx:OrderConsumer',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/unit/OrderConsumer.test.tsx'],
    },
    {
      source: 'fixture-react-frontend/tests/unit/useCreateOrder.test.ts',
      target: 'fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/unit/useCreateOrder.test.ts'],
    },
  ],

  usages: [
    { entity: 'orderApi.create', expectedCount: 1 },
    { entity: 'useCreateOrder', expectedCount: 1 },
  ],

  flows: [
    {
      name: 'create-order',
      entities: [
        'fixture-react-frontend/src/pages/OrdersPage.tsx:OrdersPage',
        'fixture-react-frontend/src/components/CreateOrderButton.tsx:CreateOrderButton',
        'fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder',
        'fixture-react-frontend/src/api/orderApi.ts:create',
      ],
    },
  ],

  paths: [
    {
      name: 'page-to-api',
      source: 'fixture-react-frontend/src/pages/OrdersPage.tsx:OrdersPage',
      target: 'fixture-react-frontend/src/api/orderApi.ts:create',
      edges: ['calls', 'calls', 'calls'],
    },
  ],

  impacts: [
    {
      entity: 'fixture-react-frontend/src/api/orderApi.ts:create',
      directDependents: ['fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder'],
      transitiveDependents: [
        'fixture-react-frontend/src/components/CreateOrderButton.tsx:CreateOrderButton',
        'fixture-react-frontend/src/pages/OrdersPage.tsx:OrdersPage',
      ],
    },
  ],

  tests: [
    {
      testPath: 'fixture-react-frontend/tests/unit/OrderConsumer.test.tsx',
      targetEntity: 'fixture-react-frontend/src/context/OrderConsumer.tsx:OrderConsumer',
      coverage: 'direct',
    },
    {
      testPath: 'fixture-react-frontend/tests/unit/useCreateOrder.test.ts',
      targetEntity: 'fixture-react-frontend/src/hooks/useCreateOrder.ts:useCreateOrder',
      coverage: 'direct',
    },
  ],

  unresolved: [],
};
