import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { type SelfCheckContentInput, selfCheckContentInput } from "../../src/build";

/** Direct compiler fixtures explicitly supply authored content, separate from prompts. */
export function fixtureSelfCheckInputs(blocks: readonly PraxityBlock[]): SelfCheckContentInput[] {
	const visit = (value: unknown): SelfCheckContentInput[] => {
		if (!value || typeof value !== "object") return [];
		if (
			Object.values(Object.getOwnPropertyDescriptors(value)).some((field) => field.get || field.set)
		)
			return [];
		if ("type" in value && value.type === "selfCheck") {
			const block = value as PraxityBlock;
			if (typeof block.id !== "string") return [];
			const prompt = block.data.content as { task: string; parts: { id: string }[] };
			try {
				return [
					selfCheckContentInput(block.id, {
						task: prompt.task,
						model: "Fixture model.",
						parts: prompt.parts.map((part) => ({
							id: part.id,
							label: "Fixture label.",
							missed: "Fixture hint.",
							evidence: null,
						})),
					}),
				];
			} catch {
				return [];
			} // Malformed prompt tests must reach compiler admission.
		}
		return Object.values(value).flatMap(visit);
	};
	try {
		return visit(blocks);
	} catch {
		return [];
	}
}
