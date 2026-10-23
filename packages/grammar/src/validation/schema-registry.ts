import { assessmentGroupSchema } from "./schemas/assessment-group-schema.ts";
import { assessmentSchema } from "./schemas/assessment-schema.ts";
import { audioSchema } from "./schemas/audio-schema.ts";
import { dialogueSchema } from "./schemas/dialogue-schema.ts";
import { embedSchema } from "./schemas/embed-schema.ts";
import { headingSchema } from "./schemas/heading-schema.ts";
import { imageSchema } from "./schemas/image-schema.ts";
import { noteSchema } from "./schemas/note-schema.ts";
import { pageBreakSchema } from "./schemas/page-break-schema.ts";
import { videoSchema } from "./schemas/video-schema.ts";
import type { BlockSchema } from "./validation-types.ts";

const BUILT_IN_SCHEMAS: BlockSchema[] = [
	imageSchema,
	assessmentSchema,
	videoSchema,
	audioSchema,
	dialogueSchema,
	embedSchema,
	noteSchema,
	assessmentGroupSchema,
	headingSchema,
	pageBreakSchema,
];

export const BLOCK_SCHEMAS = new Map<string, BlockSchema>(
	BUILT_IN_SCHEMAS.map((schema) => [schema.blockType, schema]),
);

export function registerSchema(schema: BlockSchema): void {
	BLOCK_SCHEMAS.set(schema.blockType, schema);
}

export function getSchemaForBlockType(blockType: string): BlockSchema | undefined {
	return BLOCK_SCHEMAS.get(blockType);
}

export function clearRegisteredSchemas(): void {
	BLOCK_SCHEMAS.clear();
}

export function ensureBuiltInSchemasRegistered(): void {
	for (const schema of BUILT_IN_SCHEMAS) {
		if (!BLOCK_SCHEMAS.has(schema.blockType)) {
			BLOCK_SCHEMAS.set(schema.blockType, schema);
		}
	}
}
