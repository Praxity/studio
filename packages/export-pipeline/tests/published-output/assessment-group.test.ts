import { beforeAll, describe, expect, test } from "vitest";
import { type BuildResult, getBuild } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Assessment group markup", () => {
	test("assessmentGroup header is rendered and remains present in config", () => {
		let groupFound = false;
		for (const [entryName, config] of build.configByEntry.entries()) {
			const blocks = config.blocks as Array<Record<string, unknown>> | undefined;
			const groups = blocks?.filter((b) => b.type === "assessmentGroup") ?? [];
			if (groups.length > 0) {
				groupFound = true;
				const page = build.pages.find((candidate) => candidate.entryName === entryName);
				for (const group of groups) {
					expect(
						page?.document.querySelector(`[data-assessment-group-header="${String(group.id)}"]`),
					).toBeTruthy();
				}
				break;
			}
		}
		expect(groupFound, "no assessmentGroup found in any page config").toBe(true);
	});

	test("assessmentGroup config lists member assessment IDs", () => {
		for (const config of build.configByEntry.values()) {
			const blocks = config.blocks as Array<Record<string, unknown>> | undefined;
			const groups = blocks?.filter((b) => b.type === "assessmentGroup") ?? [];
			for (const group of groups) {
				const data = group.data as Record<string, unknown> | undefined;
				const memberIds = data?.memberBlockIds ?? data?.assessmentIds ?? data?.members;
				expect(Array.isArray(memberIds), "assessmentGroup missing member IDs").toBe(true);
				expect((memberIds as unknown[]).length).toBeGreaterThan(0);
			}
		}
	});

	test("member assessments are rendered on the same page as their group", () => {
		for (const [entryName, config] of build.configByEntry.entries()) {
			const blocks = config.blocks as Array<Record<string, unknown>> | undefined;
			const groups = blocks?.filter((b) => b.type === "assessmentGroup") ?? [];
			for (const group of groups) {
				const data = group.data as Record<string, unknown> | undefined;
				const memberIds = (data?.memberBlockIds ??
					data?.assessmentIds ??
					data?.members ??
					[]) as string[];
				const pageBlocks = build.blocks.filter((b) => b.entryName === entryName);
				for (const memberId of memberIds) {
					const found = pageBlocks.find((b) => b.id === memberId);
					expect(found, `member ${memberId} not found on page ${entryName}`).toBeTruthy();
				}
			}
		}
	});
});
