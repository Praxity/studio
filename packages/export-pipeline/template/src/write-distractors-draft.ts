import { createWriteDistractorsSession } from "@praxity/shared-blocks/write-distractors-session";

export { createWriteDistractorsSession };

if (typeof window !== "undefined")
	window.__praxityDistractorsDraft = { createWriteDistractorsSession };
