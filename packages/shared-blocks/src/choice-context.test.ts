import { describe, expect, it, vi } from "vitest";
import {
	choiceDependencyStatus,
	choiceGroupDependencyIds,
	createChoiceDependencyView,
} from "./choice-learner-state";
import { admitChoiceStateFacts, choiceGroupDefinitionIsValid } from "./choice-state-facts";

it("evidence carries its status owner and observes later selection changes", () => {
	let selectedMemberId = "a";
	const evidence = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateGroups: { g: { mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] } },
		}),
		{
			rows: [{ id: "g", correct: true, memberIds: ["a"] }],
			readState: () => ({
				version: 1,
				kind: "assessmentGroup",
				mode: "oneOf",
				selectedMemberId,
				completed: false,
			}),
		},
	);
	expect(evidence.status("g")).toBe("current");
	selectedMemberId = "b";
	const status = evidence.status;
	expect(status("g")).toBe("history");
	expect(status("removed")).toBe("current");
});

it.each([
	["undefined", undefined],
	["null", null],
	["array", []],
	["string", "group"],
	["number", 27],
	["unsupported mode", { mode: "bogus", memberBlockIds: ["a"] }],
	["null mode", { mode: null, memberBlockIds: ["a"] }],
	["mixed member types", { mode: "all", memberBlockIds: ["a", 27] }],
	["empty member ID", { mode: "all", memberBlockIds: [""] }],
	["empty membership", { mode: "all", memberBlockIds: [] }],
	["string membership", { mode: "all", memberBlockIds: "a" }],
	["missing membership", { mode: "all" }],
] as const)(
	"refuses malformed raw group definition %s through the facts owner",
	(_input, definition) => {
		expect(choiceGroupDefinitionIsValid(definition)).toBe(false);
	},
);

it.each([
	["all mode", { mode: "all", memberBlockIds: ["a", "b"] }],
	["oneOf mode", { mode: "oneOf", memberBlockIds: ["a", "b"] }],
	["omitted mode", { memberBlockIds: ["a", "b"] }],
] as const)(
	"accepts supported raw group definition %s through the facts owner",
	(_input, definition) => {
		expect(choiceGroupDefinitionIsValid(definition)).toBe(true);
	},
);

describe("whole-course group facts", () => {
	it.each(["all", "oneOf"] as const)(
		"refuses an empty required set for nonempty %s membership",
		(mode) => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			try {
				const facts = admitChoiceStateFacts({
					choiceStateGroups: { g: { mode, memberIds: ["a", "b"], requiredIds: [] } },
				});
				expect(facts.choiceStateFactsStatus).toBe("invalid");
				expect(facts.choiceStateInvalidIds).toEqual(["g"]);
				expect(facts.choiceStateGroups).toEqual({});
				const view = createChoiceDependencyView(facts, { rows: [], readState: () => undefined });
				expect(view.invalidIds).toEqual(["g"]);
				expect(choiceDependencyStatus("g", view)).toBe("history");
			} finally {
				warn.mockRestore();
			}
		},
	);

	it("keeps an unanswered required dependency and refuses an empty set instead of reviving the group", () => {
		const question = {
			selectionMode: "single" as const,
			dontKnow: false,
			canAutoScore: true,
			graded: true,
			maxAttempts: 2,
			correctAnswerSignature:
				"sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
			materialSignature: `sha256:${"a".repeat(64)}`,
			options: [
				{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
				{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
			],
		};
		const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
		const submitted = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 1,
			checked: true,
			correct: true,
			completed: true,
			interacted: true,
			answer: ["a"],
		};
		const facts = admitChoiceStateFacts({
			choiceStateQuestions: { a: question, b: question },
			choiceStateSignatures: { a: signature, b: signature },
			choiceStateGroups: { g: { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] } },
		});
		expect(facts.choiceStateFactsStatus).toBe("valid");
		const view = createChoiceDependencyView(facts, {
			rows: [
				{ id: "a", correct: true },
				{ id: "g", correct: true },
			],
			readState: (id) => (id === "a" ? submitted : undefined),
		});
		expect(choiceGroupDependencyIds("g", view)).toEqual(["a", "b"]);
		expect(choiceDependencyStatus("a", view)).toBe("current");
		expect(choiceDependencyStatus("b", view)).toBe("unanswered");
		expect(choiceDependencyStatus("g", view)).toBe("history");
		const malformed = {
			...view,
			groups: { g: { mode: "all" as const, memberIds: ["a", "b"], requiredIds: [] } },
		};
		expect(choiceGroupDependencyIds("g", malformed)).toEqual([]);
		expect(choiceDependencyStatus("g", malformed)).toBe("history");
	});
	it.each(["all", "oneOf"] as const)(
		"admits %s full membership and requirements without answers",
		(mode) => {
			const facts = admitChoiceStateFacts({
				choiceStateGroups: {
					g: {
						mode,
						memberIds: ["graded", "ungraded", "private", "optional"],
						requiredIds: ["graded", "ungraded", "private"],
						answer: "not metadata",
					},
				},
			});
			expect(facts.choiceStateFactsStatus).toBe("valid");
			expect(facts.choiceStateGroups).toEqual({
				g: {
					mode,
					memberIds: ["graded", "ungraded", "private", "optional"],
					requiredIds: ["graded", "ungraded", "private"],
				},
			});
		},
	);

	it("keeps packages without group metadata distinguishable from malformed metadata", () => {
		const facts = admitChoiceStateFacts({});
		expect(facts.choiceStateFactsStatus).toBe("absent");
		expect(facts.choiceStateGroups).toBeUndefined();
	});

	it("copies group arrays and ignores inherited group metadata", () => {
		const input = {
			choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
		};
		const facts = admitChoiceStateFacts(input);
		input.choiceStateGroups.g.memberIds.push("b");
		input.choiceStateGroups.g.requiredIds.length = 0;
		expect(facts.choiceStateGroups).toEqual({
			g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
		});
		expect(admitChoiceStateFacts(Object.create(input)).choiceStateFactsStatus).toBe("absent");
	});

	it.each(["", "question"])("refuses an empty or question-colliding group ID %j", (id) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const facts = admitChoiceStateFacts({
				choiceStateGroups: { [id]: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
				choiceStateQuestions: { question: {} },
				choiceStateSignatures: {},
			});
			expect(facts.choiceStateFactsStatus).toBe("invalid");
			expect(facts.choiceStateInvalidIds).toEqual([id, "question"]);
			expect(facts.choiceStateGroups).toEqual({});
		} finally {
			warn.mockRestore();
		}
	});

	it.each([
		["null", null],
		["array", []],
		["string", "groups"],
		["number", 1],
	] as const)("refuses malformed group maps %s", (_input, choiceStateGroups) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const facts = admitChoiceStateFacts({ choiceStateGroups });
			expect(facts.choiceStateFactsStatus).toBe("invalid");
			expect(facts.choiceStateInvalidIds).toEqual(["*"]);
			expect(facts.choiceStateGroups).toEqual({});
		} finally {
			warn.mockRestore();
		}
	});

	it.each([
		["null", null],
		["array", []],
		["unsupported mode", { mode: "other", memberIds: ["a"], requiredIds: ["a"] }],
		["string membership", { mode: "all", memberIds: "a", requiredIds: ["a"] }],
		["empty membership", { mode: "all", memberIds: [], requiredIds: [] }],
		["empty member ID", { mode: "all", memberIds: [""], requiredIds: [""] }],
		["non-string member", { mode: "all", memberIds: [1], requiredIds: [1] }],
		["duplicate member", { mode: "all", memberIds: ["a", "a"], requiredIds: ["a"] }],
		["string requirements", { mode: "all", memberIds: ["a"], requiredIds: "a" }],
		["non-member requirement", { mode: "all", memberIds: ["a"], requiredIds: ["missing"] }],
		["nested group", { mode: "all", memberIds: ["g"], requiredIds: ["g"] }],
	] as const)("refuses malformed group %s while retaining an unrelated group", (_input, g) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const facts = admitChoiceStateFacts({
				choiceStateGroups: { g, good: { mode: "oneOf", memberIds: ["b"], requiredIds: ["b"] } },
			});
			expect(facts.choiceStateFactsStatus).toBe("invalid");
			expect(facts.choiceStateInvalidIds).toEqual(["g"]);
			expect(facts.choiceStateGroups).toEqual({
				good: { mode: "oneOf", memberIds: ["b"], requiredIds: ["b"] },
			});
		} finally {
			warn.mockRestore();
		}
	});

	it("refuses nested group dependencies", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const facts = admitChoiceStateFacts({
				choiceStateGroups: {
					parent: { mode: "all", memberIds: ["child"], requiredIds: ["child"] },
					child: { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
				},
			});
			expect(facts.choiceStateInvalidIds).toEqual(["parent"]);
			expect(facts.choiceStateGroups).toEqual({
				child: { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
			});
		} finally {
			warn.mockRestore();
		}
	});

	it.each(["constructor", "toString", "__proto__"])(
		"owns the %s group key without inherited lookup",
		(id) => {
			const facts = admitChoiceStateFacts(
				JSON.parse(
					`{"choiceStateGroups":{"${id}":{"mode":"all","memberIds":["a"],"requiredIds":["a"]}}}`,
				),
			);
			expect(Object.hasOwn(facts.choiceStateGroups ?? {}, id)).toBe(true);
			expect(facts.choiceStateGroups?.[id]).toEqual({
				mode: "all",
				memberIds: ["a"],
				requiredIds: ["a"],
			});
		},
	);
});

describe("dormant evidence view", () => {
	it("preserves full admitted question and group facts without reading an answer", () => {
		const question = {
			selectionMode: "single" as const,
			dontKnow: false,
			canAutoScore: true,
			graded: true,
			maxAttempts: 2,
			correctAnswerSignature:
				"sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
			materialSignature: `sha256:${"a".repeat(64)}`,
			options: [
				{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
				{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
			],
		};
		const readState = vi.fn();
		const view = createChoiceDependencyView(
			admitChoiceStateFacts({
				choiceStateQuestions: { q: question },
				choiceStateSignatures: {
					q: "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d",
				},
				choiceStateGroups: {
					g: { mode: "oneOf", memberIds: ["optional", "q"], requiredIds: ["q"] },
				},
			}),
			{ rows: [], readState },
		);
		expect(view.questions).toEqual({ q: question });
		expect(view.signatures).toEqual({
			q: "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d",
		});
		expect(view.groups).toEqual({
			g: { mode: "oneOf", memberIds: ["optional", "q"], requiredIds: ["q"] },
		});
		expect(readState).not.toHaveBeenCalled();
	});
	it("keeps rows and state reads intact", () => {
		const rows = [
			{ id: "a", correct: true },
			{ id: "a", correct: false },
		];
		const readState = vi.fn(() => ({ answer: ["draft"], checked: false }));
		const view = createChoiceDependencyView(admitChoiceStateFacts({}), { rows, readState });
		expect(view.rows).toEqual([
			{ id: "a", correct: true },
			{ id: "a", correct: false },
		]);
		expect(view.questions).toEqual({});
		expect(view.signatures).toEqual({});
		expect(view.groups).toBeUndefined();
		expect(readState).not.toHaveBeenCalled();
		expect(view.readState("a")).toEqual({ answer: ["draft"], checked: false });
		expect(readState).toHaveBeenCalledExactlyOnceWith("a");
	});

	it("refuses cleaned invalid metadata instead of treating it as legacy facts", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(() =>
				createChoiceDependencyView(admitChoiceStateFacts({ choiceStateGroups: null }), {
					rows: [],
					readState: () => undefined,
				}),
			).toThrow("Invalid choice facts");
		} finally {
			warn.mockRestore();
		}
	});
});
