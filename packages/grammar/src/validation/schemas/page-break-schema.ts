import { NAV_ARCHETYPES } from "../../nav-archetype-layout.ts";
import {
	BOOLEAN_NAV_KEYS,
	NAV_PRESET_KEYS,
	PROGRESS_STYLES,
	READING_SUPPORT_PLACEMENTS,
} from "../../nav-archetype-presets.ts";
import type { BlockSchema, SchemaAttribute, ValidationError } from "../validation-types.ts";

const PAGE_NAV_ARCHETYPES = NAV_ARCHETYPES.filter((archetype) => archetype !== "custom");

const KNOWN_PAGE_KEYS = new Set<string>([
	"title",
	"label",
	"style",
	"pageStyle",
	"duration",
	"deckStop",
	"narration",
	"captions",
	"nav",
	"focus",
	"hide",
	...NAV_PRESET_KEYS,
]);

const booleanNavAttributes: Record<string, SchemaAttribute> = Object.fromEntries(
	BOOLEAN_NAV_KEYS.map((key) => [
		key,
		{ type: "boolean", required: false, errorLevel: "warning" } satisfies SchemaAttribute,
	]),
);

export const pageBreakSchema: BlockSchema = {
	keyword: "---",
	blockType: "pageBreak",
	attributes: {
		pageStyle: { type: "string", required: false },
		deckStop: { type: "boolean", required: false },
		nav: {
			type: "enum",
			required: false,
			matches: PAGE_NAV_ARCHETYPES,
			errorLevel: "warning",
			description: "Per-page navigation archetype override.",
		},
		navProgressStyle: {
			type: "enum",
			required: false,
			matches: PROGRESS_STYLES,
			errorLevel: "warning",
		},
		navReadingSupportPlacement: {
			type: "enum",
			required: false,
			matches: READING_SUPPORT_PLACEMENTS,
			errorLevel: "warning",
		},
		...booleanNavAttributes,
		hide: { type: "boolean", required: false, errorLevel: "warning" },
		// `focus` and `duration` are validated at block level below: the parser
		// coerces true/false to booleans (focus), and `duration` doubles as the
		// reading-time toggle (show|hide) AND the documented page-transition
		// duration (e.g. 500ms), so neither fits a plain string enum.
	},
	validate(block): ValidationError[] {
		const errors: ValidationError[] = [];
		const data = (block.data ?? {}) as Record<string, unknown>;
		const duration = data.duration;
		if (
			duration !== undefined &&
			duration !== "show" &&
			duration !== "hide" &&
			!(typeof duration === "string" && /^\d+(\.\d+)?m?s$/.test(duration)) &&
			typeof duration !== "number"
		) {
			errors.push({
				id: "invalid-duration",
				level: "warning",
				message: `"duration" must be show, hide, or a CSS time (e.g. 500ms), got "${String(duration)}".`,
				blockId: block.id,
				blockType: block.type,
				attribute: "duration",
				category: "content",
			});
		}

		const focus = data.focus;
		if (focus !== undefined && focus !== "on" && focus !== "off" && typeof focus !== "boolean") {
			errors.push({
				id: "invalid-focus",
				level: "warning",
				message: `"focus" must be on or off, got "${String(focus)}".`,
				blockId: block.id,
				blockType: block.type,
				attribute: "focus",
				category: "content",
			});
		}

		for (const key of Object.keys(data)) {
			if (key.startsWith("nav") && !KNOWN_PAGE_KEYS.has(key)) {
				errors.push({
					id: `unknown-nav-param-${key}`,
					level: "warning",
					message: `Unknown page nav setting "${key}". Valid keys: nav, ${NAV_PRESET_KEYS.join(", ")}.`,
					blockId: block.id,
					blockType: block.type,
					attribute: key,
					category: "content",
				});
			}
		}
		return errors;
	},
};
