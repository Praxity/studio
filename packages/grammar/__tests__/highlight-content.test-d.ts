import type { HighlightContent } from "@praxity/content-model/types";
import type { Content as UpstreamHighlightContent } from "learning-patterns/patterns/highlight/logic.js";
import { expectTypeOf, it } from "vitest";

it("keeps the public highlight content type equal to upstream Content", () => {
	expectTypeOf<HighlightContent>().toEqualTypeOf<UpstreamHighlightContent>();
});
