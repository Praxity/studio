export { describeDocument, lexicalScore, normalizeText, serializeIdentity } from "./canonical.ts";
export {
	assertIdentitySnapshotNamespace,
	assertLegacyIdentitySnapshot,
	parseCourseIdentity,
	parseIdentitySnapshot,
	parseIdentitySnapshotRecord,
	parseLessonHead,
} from "./files.ts";
export { invertIdentityMapping } from "./mappings.ts";
export { mergeIdentity } from "./merge.ts";
export { canRestoreIdentityMetadata, restoreIdentityMetadata } from "./metadata.ts";
export { identityKey } from "./reconcile.ts";
export {
	assertDurableCandidate,
	committedIdentityView,
	createIdentityPlan,
	createIdentityReadSession,
	createIdentityResolver,
	isDurableIdentity,
	resolveIdentity,
} from "./resolve.ts";
export type * from "./types.ts";
