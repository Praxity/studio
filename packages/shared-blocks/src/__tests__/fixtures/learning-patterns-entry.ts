// Keep the dependency reachable in the notice test without adding a production probe.
import schema from "learning-patterns/patterns/self-check/content.schema.json";
import {
	annotate,
	feedback,
	validateContent,
	validateState,
} from "learning-patterns/patterns/self-check/logic.js";
import { strings } from "learning-patterns/patterns/self-check/strings.js";

export { annotate, feedback, schema, strings, validateContent, validateState };
