import { createHash } from 'node:crypto';
import { KEYSTONE_OKF_PROFILE_ID, KEYSTONE_OKF_PROFILE_VERSION, type KeystoneKnowledgeKind, type KeystoneRelationshipKind } from './types';

export interface RelationshipConstraint { readonly sources: readonly KeystoneKnowledgeKind[]; readonly targets: readonly KeystoneKnowledgeKind[]; }
export interface KeystoneOkfProfileDefinition {
  readonly id: typeof KEYSTONE_OKF_PROFILE_ID; readonly version: typeof KEYSTONE_OKF_PROFILE_VERSION; readonly title: string;
  readonly knowledgeKinds: readonly KeystoneKnowledgeKind[]; readonly relationshipKinds: readonly KeystoneRelationshipKind[];
  readonly requiredUnitFields: readonly string[]; readonly requiredRelationshipFields: readonly string[];
  readonly requiredObservationFields: readonly string[]; readonly relationshipConstraints: Readonly<Partial<Record<KeystoneRelationshipKind, RelationshipConstraint>>>;
}
const kinds: readonly KeystoneKnowledgeKind[] = ['repository','workspace','file','module','package','service','symbol','api','data-entity','configuration','test','documentation','call-flow','data-flow','architecture-boundary','risk-area','change-impact'];
const any = kinds;
export const KEYSTONE_OKF_PROFILE: KeystoneOkfProfileDefinition = Object.freeze({
  id: KEYSTONE_OKF_PROFILE_ID, version: KEYSTONE_OKF_PROFILE_VERSION, title: 'Keystone Repository Intelligence OKF Profile',
  knowledgeKinds: kinds,
  relationshipKinds: ['contains','defines','imports','depends-on','calls','reads','writes','exposes','implements','extends','tests','covers','configured-by','documented-by','flows-to','may-impact'] as readonly KeystoneRelationshipKind[],
  requiredUnitFields: ['id','profile','profileVersion','kind','name','canonicalKey','properties','confidence','provenance','lifecycle','firstSeenAt','lastSeenAt','createdAt','updatedAt'],
  requiredRelationshipFields: ['id','profile','profileVersion','kind','sourceId','targetId','properties','confidence','provenance','lifecycle','firstSeenAt','lastSeenAt','createdAt','updatedAt'],
  requiredObservationFields: ['id','profile','profileVersion','subjectId','predicate','valueType','confidence','provenance','observedAt'],
  relationshipConstraints: ({
    contains: { sources: ['workspace','repository','module','service','architecture-boundary'], targets: any },
    defines: { sources: ['file','test','documentation','configuration','module','service'], targets: ['symbol','api','data-entity','service','call-flow','data-flow'] },
    imports: { sources: ['file','test','module'], targets: ['file','test','module','package'] },
    'depends-on': { sources: any, targets: any }, calls: { sources: ['symbol','api','call-flow'], targets: ['symbol','api','service','call-flow'] },
    reads: { sources: ['symbol','api','service','data-flow'], targets: ['data-entity','configuration','file'] },
    writes: { sources: ['symbol','api','service','data-flow'], targets: ['data-entity','configuration','file'] },
    exposes: { sources: ['file','service','module'], targets: ['api'] }, implements: { sources: ['symbol','service'], targets: ['symbol','architecture-boundary'] },
    extends: { sources: ['symbol'], targets: ['symbol'] }, tests: { sources: ['test'], targets: ['file','symbol','api','service'] },
    covers: { sources: ['test'], targets: ['file','symbol','api','service'] }, 'configured-by': { sources: any, targets: ['configuration'] },
    'documented-by': { sources: any, targets: ['documentation'] }, 'flows-to': { sources: ['call-flow','data-flow','api','service','symbol','file','data-entity'], targets: any },
    'may-impact': { sources: ['change-impact','risk-area','file','symbol','service'], targets: any }
  } as Partial<Record<KeystoneRelationshipKind, RelationshipConstraint>>)
});
export const KEYSTONE_OKF_PROFILE_DIGEST = createHash('sha256').update(JSON.stringify(KEYSTONE_OKF_PROFILE)).digest('hex');
