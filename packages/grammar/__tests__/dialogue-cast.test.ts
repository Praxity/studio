import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import {
	formatDialogueWarning,
	normalizeDialogueCast,
	resolveDialogueSpeakers,
} from "../src/index.ts";
import { readBlockFixture as readBlockSource } from "./helpers/lesson-fixture.ts";

describe("dialogue cast", () => {
	it("normalizes valid entries and reports invalid ones", () => {
		const { cast, warnings } = normalizeDialogueCast({
			Roger: { name: "Roger", avatar: "assets/roger.png", voice: "v1" },
			"bad key": { name: "X" },
			noname: { avatar: "a.png" },
			weird: "string",
		});
		expect(cast).toEqual({ roger: { name: "Roger", avatar: "assets/roger.png", voice: "v1" } });
		expect(warnings).toHaveLength(3);
		expect(normalizeDialogueCast("nope")).toEqual({
			cast: {},
			warnings: ["cast must be a map of speaker keys."],
		});
		expect(normalizeDialogueCast({ nameless: {} }, "fr").warnings[0]).toContain("nom");
	});

	it("rejects remote cast and local avatar URLs with warnings", () => {
		const normalized = normalizeDialogueCast({
			alex: { name: "Alex", avatar: "https://example.com/a.png" },
		});
		expect(normalized.cast.alex.avatar).toBeUndefined();
		expect(normalized.warnings.join(" ")).toMatch(/avatar.*https/i);
		const { blocks } = readBlockSource(
			"---\n{ cast: { alex: { avatar: https://example.com/a.png } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- alex: Hi\n:::\n",
		);
		const resolved = resolveDialogueSpeakers(blocks, {
			alex: { name: "Alex", avatar: "assets/good.png" },
		});
		expect(resolved.blocks[0].data.turns[0].avatar).toBeUndefined();
		expect(resolved.warnings.some((warning) => warning.code === "invalid-avatar")).toBe(true);
	});

	it("resolves turns from local speakers over the cast, case-insensitively", () => {
		const { blocks } = readBlockSource(
			"---\n{ cast: { coach: { name: Coach Lee, avatar: none }, roger: {}, zed: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- roger: Hi\n- COACH: Hello\n- Zed: Hey\n:::\n",
		);
		const { cast } = normalizeDialogueCast({
			roger: { name: "Roger R.", avatar: "assets/roger.png" },
			coach: { name: "Cast Coach", avatar: "assets/coach.png", voice: "v2" },
		});
		const resolved = resolveDialogueSpeakers(blocks, cast);
		expect(resolved.blocks[0].data.turns).toEqual([
			{
				id: "00000000-0000-4000-8000-000000000002",
				speaker: "roger",
				paragraphs: ["Hi"],
				name: "Roger R.",
				avatar: "assets/roger.png",
			},
			{
				id: "00000000-0000-4000-8000-000000000003",
				speaker: "COACH",
				paragraphs: ["Hello"],
				name: "Coach Lee",
				voice: "v2",
			},
			{
				id: "00000000-0000-4000-8000-000000000004",
				speaker: "Zed",
				paragraphs: ["Hey"],
				name: "Zed",
			},
		]);
		expect(resolved.warnings).toEqual([
			{ blockId: blocks[0].id, code: "unknown-speaker", speaker: "Zed" },
		]);
		expect(formatDialogueWarning(resolved.warnings[0], "en")).toEqual({
			blockId: blocks[0].id,
			message: `Unknown speaker "Zed" in dialogue ${blocks[0].id}`,
		});
		expect(formatDialogueWarning(resolved.warnings[0], "fr-CA")).toEqual({
			blockId: blocks[0].id,
			message: `Interlocuteur inconnu « Zed » dans le dialogue ${blocks[0].id}`,
		});
		expect(blocks[0].data.turns[0].name).toBeUndefined();
	});

	it("clears a mixed-case avatar none override", () => {
		const { blocks } = readBlockSource(
			"---\n{ cast: { roger: { avatar: NoNe } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Roger: Hi\n:::\n",
		);
		const resolved = resolveDialogueSpeakers(blocks, {
			roger: { name: "Roger", avatar: "assets/roger.png" },
		});
		expect(resolved.blocks[0].data.turns[0]).toMatchObject({ speaker: "Roger", name: "Roger" });
		expect(resolved.blocks[0].data.turns[0].avatar).toBeUndefined();
		expect(resolved.warnings).toEqual([]);
	});

	it("resolves cast sides, local overrides, and invalid values", () => {
		const parsed = readBlockSource(
			"---\ncast:\n  learner: {name: Learner, side: end}\n  coach: {name: Coach, side: wrong}\n---\n\n# Fixture {hideTitle}\n\n::: dialogue\n- learner: First\n- coach: Reply\n:::\n",
		);
		const { blocks } = parsed;
		expect(
			normalizeDialogueCast(parsed.frontmatter.cast).warnings.some((warning) =>
				warning.includes("side"),
			),
		).toBe(true);
		const { cast, warnings } = normalizeDialogueCast({
			learner: { name: "Learner", side: "start" },
			coach: { name: "Coach", side: "end" },
			bad: { name: "Bad", side: "left" },
		});
		expect(cast.learner.side).toBe("start");
		expect(cast.bad.side).toBeUndefined();
		expect(warnings.join(" ")).toMatch(/side.*left/);
		expect(() =>
			normalizeDialogueCast({ bad: { name: "Bad", side: { toString: null } } }),
		).not.toThrow();
		expect(
			normalizeDialogueCast({ bad: { name: "Bad", side: "left" } }, "fr").warnings[0],
		).toContain("côté");
		blocks[0].data.speakers.coach.side = "wrong" as never;
		const resolved = resolveDialogueSpeakers(blocks, cast);
		expect(resolved.blocks[0].data.turns.map((turn: { side?: string }) => turn.side)).toEqual([
			"end",
			"end",
		]);
		expect(resolved.warnings.some((warning) => warning.code === "invalid-side")).toBe(true);
		expect(formatDialogueWarning(resolved.warnings[0], "fr").message).toContain("côté");
	});

	it("keeps unattributed turns unnamed and uses a local key when its name is absent", () => {
		const { blocks } = readBlockSource(
			"---\ncast:\n  coach: {voice: v1}\n---\n\n# Fixture {hideTitle}\n\n::: dialogue\n- COACH: Hi\n:::\n",
		);
		// G4 requires attributed source turns. The resolver also accepts persisted
		// unattributed turns, so exercise that fallback through its model interface.
		blocks[0].data.turns.unshift({
			id: "00000000-0000-4000-8000-000000000004",
			paragraphs: ["Hello"],
		});
		const [unattributed] = blocks[0].data.turns as Array<Record<string, unknown>>;
		Object.assign(unattributed, { name: "stale", avatar: "stale.png", voice: "stale" });
		const resolved = resolveDialogueSpeakers(blocks);
		expect(resolved.blocks[0].data.turns).toEqual([
			{ id: "00000000-0000-4000-8000-000000000004", paragraphs: ["Hello"] },
			{
				id: "00000000-0000-4000-8000-000000000002",
				speaker: "COACH",
				paragraphs: ["Hi"],
				name: "COACH",
				voice: "v1",
			},
		]);
		expect(resolved.warnings).toEqual([]);
	});

	it("ignores malformed local speaker fields and speaker maps", () => {
		const { blocks } = readBlockSource(
			"---\n{ cast: { roger: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Roger: Hi\n:::\n",
		);
		const cast = { roger: { name: "Cast Roger", avatar: "cast.png", voice: "cast voice" } };
		for (const [speakers, voice] of [
			[{ Roger: { name: 42, avatar: {}, voice: " local voice " } }, "local voice"],
			[{ Roger: { name: " ", avatar: "", voice: 42 } }, "cast voice"],
			[[], "cast voice"],
			[null, "cast voice"],
		] as const) {
			blocks[0].data.speakers = speakers;
			const resolved = resolveDialogueSpeakers(blocks, cast);
			expect(resolved.blocks[0].data.turns).toEqual([
				{
					id: "00000000-0000-4000-8000-000000000002",
					speaker: "Roger",
					paragraphs: ["Hi"],
					name: "Cast Roger",
					avatar: "cast.png",
					voice,
				},
			]);
		}
	});

	it("does not use an inherited dialogue type from a JSON __proto__ key", () => {
		const block = JSON.parse(
			'{"id":"block-1","__proto__":{"type":"dialogue"},"data":{"turns":[{"id":"item-0","speaker":"Roger","paragraphs":["Hi"]}]}}',
		) as PraxityBlock;
		const { blocks } = resolveDialogueSpeakers([block], { roger: { name: "Cast Roger" } });
		expect(Object.getPrototypeOf(blocks[0])).toBe(Object.prototype);
		expect(Object.hasOwn(blocks[0], "type")).toBe(false);
		expect(blocks[0].data.turns).toEqual([{ id: "item-0", speaker: "Roger", paragraphs: ["Hi"] }]);
	});

	it("resolves dialogue inside container children without changing the source", () => {
		const [dialogue] = readBlockSource(
			"---\n{ cast: { roger: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Roger: Hi\n:::\n",
		).blocks;
		const blocks = [
			{ id: "card-1", type: "card", data: { items: [{ children: [dialogue] }] } },
		] as PraxityBlock[];
		const resolved = resolveDialogueSpeakers(blocks, { roger: { name: "Roger R." } });
		expect(
			(resolved.blocks[0].data.items as Array<{ children: PraxityBlock[] }>)[0].children[0].data
				.turns,
		).toEqual([
			{
				id: "00000000-0000-4000-8000-000000000002",
				speaker: "Roger",
				paragraphs: ["Hi"],
				name: "Roger R.",
			},
		]);
		expect(dialogue.data.turns).toEqual([
			{ id: "00000000-0000-4000-8000-000000000002", speaker: "Roger", paragraphs: ["Hi"] },
		]);
	});
});
