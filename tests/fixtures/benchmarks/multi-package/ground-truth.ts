// Ground-truth manifest for multi-package fixture
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
  repositoryId: 'fixture-multi-package',

  entities: [
    // App package
    {
      kind: 'file',
      name: 'App.tsx',
      qualifiedName: 'fixture-multi-package/packages/app/src/App.tsx:App',
      filePath: 'packages/app/src/App.tsx',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { package: '@bench-app' },
    },
    {
      kind: 'route',
      name: 'App routes',
      qualifiedName: 'fixture-multi-package/packages/app/src/routes.tsx',
      filePath: 'packages/app/src/routes.tsx',
      startLine: 1,
      endLine: 5,
      confidence: 'exact',
      metadata: { package: '@bench-app' },
    },
    {
      kind: 'component',
      name: 'UserCard',
      qualifiedName: 'fixture-multi-package/packages/app/src/components/UserCard.tsx:UserCard',
      filePath: 'packages/app/src/components/UserCard.tsx',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { package: '@bench-app', props: ['user', 'formattedDate'] },
    },
    // Shared package
    {
      kind: 'file',
      name: 'index.ts',
      qualifiedName: 'fixture-multi-package/packages/shared/src/index.ts',
      filePath: 'packages/shared/src/index.ts',
      startLine: 1,
      endLine: 3,
      confidence: 'exact',
      metadata: { package: '@bench-shared', entry: true },
    },
    {
      kind: 'interface',
      name: 'User',
      qualifiedName: 'fixture-multi-package/packages/shared/src/User.ts:User',
      filePath: 'packages/shared/src/User.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { package: '@bench-shared', properties: ['id', 'email', 'name', 'createdAt'] },
    },
    {
      kind: 'function',
      name: 'createUser',
      qualifiedName: 'fixture-multi-package/packages/shared/src/User.ts:createUser',
      filePath: 'packages/shared/src/User.ts',
      startLine: 1,
      endLine: 15,
      confidence: 'exact',
      metadata: { package: '@bench-shared' },
    },
    {
      kind: 'class',
      name: 'UserService',
      qualifiedName: 'fixture-multi-package/packages/shared/src/UserService.ts:UserService',
      filePath: 'packages/shared/src/UserService.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { package: '@bench-shared', methods: ['register', 'findById', 'findByEmail', 'all'] },
    },
    // Utils package
    {
      kind: 'function',
      name: 'formatDate',
      qualifiedName: 'fixture-multi-package/packages/utils/src/formatDate.ts:formatDate',
      filePath: 'packages/utils/src/formatDate.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { package: '@bench-utils' },
    },
    {
      kind: 'function',
      name: 'validateEmail',
      qualifiedName: 'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      filePath: 'packages/utils/src/validateEmail.ts',
      startLine: 1,
      endLine: 10,
      confidence: 'exact',
      metadata: { package: '@bench-utils' },
    },
    // Tests
    {
      kind: 'test',
      name: 'shared.test.ts',
      qualifiedName: 'fixture-multi-package/tests/unit/shared.test.ts',
      filePath: 'tests/unit/shared.test.ts',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { targets: ['UserService', 'createUser', 'validateEmail'] },
    },
    {
      kind: 'test',
      name: 'app.test.tsx',
      qualifiedName: 'fixture-multi-package/tests/unit/app.test.tsx',
      filePath: 'tests/unit/app.test.tsx',
      startLine: 1,
      endLine: 20,
      confidence: 'exact',
      metadata: { targets: ['App'] },
    },
  ],

  relationships: [
    // App → shared
    {
      source: 'fixture-multi-package/packages/app/src/App.tsx:App',
      target: 'fixture-multi-package/packages/shared/src/UserService.ts:UserService',
      type: 'imports',
      confidence: 'exact',
      evidence: ['packages/app/src/App.tsx:1'],
    },
    {
      source: 'fixture-multi-package/packages/app/src/components/UserCard.tsx:UserCard',
      target: 'fixture-multi-package/packages/shared/src/User.ts:User',
      type: 'imports',
      confidence: 'exact',
      evidence: ['packages/app/src/components/UserCard.tsx:1'],
    },
    // App → utils
    {
      source: 'fixture-multi-package/packages/app/src/App.tsx:App',
      target: 'fixture-multi-package/packages/utils/src/formatDate.ts:formatDate',
      type: 'imports',
      confidence: 'exact',
      evidence: ['packages/app/src/App.tsx:2'],
    },
    // Shared → utils (circular: utils → shared)
    {
      source: 'fixture-multi-package/packages/shared/src/User.ts:createUser',
      target: 'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      type: 'calls',
      confidence: 'exact',
      evidence: ['packages/shared/src/User.ts:5'],
    },
    {
      source: 'fixture-multi-package/packages/shared/src/UserService.ts:UserService.register',
      target: 'fixture-multi-package/packages/shared/src/User.ts:createUser',
      type: 'calls',
      confidence: 'exact',
      evidence: ['packages/shared/src/UserService.ts:5'],
    },
    // Utils → shared (circular)
    {
      source: 'fixture-multi-package/packages/utils/src/formatDate.ts:formatDate',
      target: 'fixture-multi-package/packages/shared/src/UserService.ts:now',
      type: 'imports',
      confidence: 'exact',
      evidence: ['packages/utils/src/formatDate.ts:1'],
    },
    // Tests
    {
      source: 'fixture-multi-package/tests/unit/shared.test.ts',
      target: 'fixture-multi-package/packages/shared/src/UserService.ts:UserService',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/unit/shared.test.ts'],
    },
    {
      source: 'fixture-multi-package/tests/unit/shared.test.ts',
      target: 'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/unit/shared.test.ts'],
    },
    {
      source: 'fixture-multi-package/tests/unit/app.test.tsx',
      target: 'fixture-multi-package/packages/app/src/App.tsx:App',
      type: 'covers',
      confidence: 'exact',
      evidence: ['tests/unit/app.test.tsx'],
    },
  ],

  usages: [
    { entity: 'UserService.register', expectedCount: 1 },
    { entity: 'validateEmail', expectedCount: 1 },
    { entity: 'formatDate', expectedCount: 1 },
  ],

  flows: [
    {
      name: 'user-registration',
      entities: [
        'fixture-multi-package/packages/app/src/App.tsx:App',
        'fixture-multi-package/packages/shared/src/UserService.ts:UserService.register',
        'fixture-multi-package/packages/shared/src/User.ts:createUser',
        'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      ],
    },
    {
      name: 'user-rendering',
      entities: [
        'fixture-multi-package/packages/app/src/App.tsx:App',
        'fixture-multi-package/packages/app/src/components/UserCard.tsx:UserCard',
        'fixture-multi-package/packages/utils/src/formatDate.ts:formatDate',
      ],
    },
  ],

  paths: [
    {
      name: 'app-to-utils-via-shared',
      source: 'fixture-multi-package/packages/app/src/App.tsx:App',
      target: 'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      edges: ['imports', 'calls'],
    },
  ],

  impacts: [
    {
      entity: 'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      directDependents: [
        'fixture-multi-package/packages/shared/src/User.ts:createUser',
      ],
      transitiveDependents: [
        'fixture-multi-package/packages/shared/src/UserService.ts:UserService.register',
        'fixture-multi-package/packages/app/src/App.tsx:App',
      ],
    },
  ],

  tests: [
    {
      testPath: 'fixture-multi-package/tests/unit/shared.test.ts',
      targetEntity: 'fixture-multi-package/packages/shared/src/UserService.ts:UserService',
      coverage: 'direct',
    },
    {
      testPath: 'fixture-multi-package/tests/unit/shared.test.ts',
      targetEntity: 'fixture-multi-package/packages/utils/src/validateEmail.ts:validateEmail',
      coverage: 'direct',
    },
    {
      testPath: 'fixture-multi-package/tests/unit/app.test.tsx',
      targetEntity: 'fixture-multi-package/packages/app/src/App.tsx:App',
      coverage: 'direct',
    },
  ],

  unresolved: [],
};
