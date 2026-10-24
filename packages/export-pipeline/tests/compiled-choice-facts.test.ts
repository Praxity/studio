// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import * as choiceCompiler from "@praxity/shared-blocks/assessment-choice";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { expect, it, vi } from "vitest";
import {
	type CourseConfig,
	generateHtmlPage,
	prepareHtmlCourse,
	renderHtmlDocument,
} from "../src/html-gen";
import { readCoreCourseConfig, readCourseHostConfig } from "../template/src/hosts/course-config";
import { readViewerConfig } from "../template/src/islands/utils";
import { stripChoiceStateFacts } from "./fixtures/choice-facts";
import { compilerFixture, compilerIslandAssets } from "./fixtures/page-compiler";

function course() {
	let id = 0;
	const read = readLesson("# Practice\n::: choice Pick one\n(x) Yes\n( ) No\n:::\n", {
		ids: () => `q-${++id}`,
	});
	return {
		id: "course",
		title: "Practice",
		sourceLocale: "en",
		totalPages: 1,
		pages: read.pages,
	} as CourseConfig;
}
function render(config = course()) {
	return generateHtmlPage({
		config,
		page: config.pages[0],
		index: 0,
		currentSlug: "practice",
		slugList: [{ pageId: config.pages[0].id, title: "Practice", slug: "practice" }],
		slugMap: new Map([[config.pages[0].id, "practice"]]),
		islandAssets: compilerIslandAssets,
	});
}
function choice(config: CourseConfig) {
	const block = config.pages[0].blocks.find((block) => block.type === "assessment");
	if (!block) throw Error("Missing choice");
	return block;
}
function scriptElement(id: string) {
	const script = document.getElementById(id);
	if (!script?.textContent) throw Error(`Missing config ${id}`);
	return script;
}

function groupedCourse(mode: "all" | "oneOf") {
	const config = course();
	const a = choice(config);
	a.id = "a";
	Object.assign(a.data, { required: true, gradingMode: "exact" });
	const ungraded = { ...structuredClone(a), id: "ungraded" };
	Object.assign(ungraded.data, { gradingMode: "none", required: true });
	const optional = { ...structuredClone(a), id: "optional" };
	Object.assign(optional.data, { gradingMode: "none", required: false });
	const privateMember = {
		id: "private",
		type: "assessment" as const,
		data: {
			assessmentType: "textResponse",
			question: "Reflect",
			gradingMode: "none",
			required: true,
			private: true,
			response: {},
		},
	};
	config.pages[0].blocks = [
		{
			id: "g",
			type: "assessmentGroup",
			data: { mode, memberBlockIds: ["optional", "a", "ungraded", "private"] },
		},
		a,
		ungraded,
		privateMember,
		optional,
	];
	config.pages.push({
		id: "second",
		title: "Second",
		blocks: [
			{ id: "other", type: "assessmentGroup", data: { mode: "all", memberBlockIds: ["b"] } },
			{ ...structuredClone(a), id: "b" },
		],
	});
	config.totalPages = 2;
	return config;
}

it.each([
	{ mode: "bogus", memberBlockIds: ["a"] },
	{ mode: null, memberBlockIds: ["a"] },
	{ mode: 27, memberBlockIds: ["a"] },
	{ mode: "", memberBlockIds: ["a"] },
	{ mode: "oneOf", memberBlockIds: ["a", 27] },
	{ mode: "all", memberBlockIds: [] },
	{ mode: "all" },
	{ mode: "all", memberBlockIds: "a" },
	{ mode: "all", memberBlockIds: null },
])("refuses raw group definition %j before renderer normalization", (data) => {
	const config = groupedCourse("all");
	config.pages[0].blocks[0].data = data;
	const error = 'Invalid choice fact for block "g": group definition';
	expect(() => prepareHtmlCourse(config)).toThrow(error);
	expect(() => render(config)).toThrow(error);
});

it.each([
	[{ mode: "all", memberBlockIds: ["a"] }, "all"],
	[{ mode: "oneOf", memberBlockIds: ["a"] }, "oneOf"],
	[{ memberBlockIds: ["a"] }, "all"],
] as const)("keeps supported raw group definition %j", (data, mode) => {
	const config = groupedCourse("all");
	config.pages[0].blocks[0].data = structuredClone(data);
	const prepared = prepareHtmlCourse(config);
	expect(prepared.choiceFacts.choiceStateGroups?.g).toEqual({
		mode,
		memberIds: ["a"],
		requiredIds: ["a"],
	});
	const admitted = admitChoiceStateFacts({ ...prepared.choiceFacts });
	expect(admitted.choiceStateFactsStatus).toBe("valid");
	expect(admitted.choiceStateInvalidIds).toEqual([]);
});

it.each([
	["only holes", new Array(1)],
	// biome-ignore lint/suspicious/noSparseArray: Reproduce a direct API member followed by a missing index.
	["member then hole", ["a", ,]],
])("refuses sparse raw group membership: %s", (_input, memberBlockIds) => {
	const config = groupedCourse("all");
	config.pages[0].blocks[0].data = { mode: "all", memberBlockIds };
	const error = 'Invalid choice fact for block "g": group definition';
	expect(() => prepareHtmlCourse(config)).toThrow(error);
	expect(() => render(config)).toThrow(error);
});

it.each(["all", "oneOf"] as const)(
	"publishes %s whole-course group facts in both configs on every page",
	(mode) => {
		const prepared = prepareHtmlCourse(groupedCourse(mode), compilerIslandAssets);
		const expected = {
			g: {
				mode,
				memberIds: ["optional", "a", "ungraded", "private"],
				requiredIds: ["a", "ungraded", "private"],
			},
			other: { mode: "all", memberIds: ["b"], requiredIds: ["b"] },
		};
		expect(prepared.choiceFacts.choiceStateGroups).toEqual(expected);
		for (const { slug } of prepared.slugList) {
			const doc = new DOMParser().parseFromString(
				renderHtmlDocument(prepared, slug, { islandAssets: compilerIslandAssets }, () => ""),
				"text/html",
			);
			expect(readCourseHostConfig(doc)?.choiceStateGroups).toEqual(expected);
			for (const id of ["praxity-host-config", "praxity-config"]) {
				const raw = JSON.parse(doc.getElementById(id)?.textContent ?? "{}");
				const admitted = admitChoiceStateFacts(raw);
				expect(admitted.choiceStateFactsStatus).toBe("valid");
				expect(admitted.choiceStateInvalidIds).toEqual([]);
				expect(admitted.choiceStateGroups).toEqual(expected);
			}
		}
	},
);

it.each(["all", "oneOf"] as const)(
	"admits %s group-only facts with all-member fallback",
	(mode) => {
		const config = groupedCourse(mode);
		config.pages = [config.pages[0]];
		config.totalPages = 1;
		config.pages[0].blocks = [
			{ id: "g", type: "assessmentGroup", data: { mode, memberBlockIds: ["reflection"] } },
			{
				id: "reflection",
				type: "assessment",
				data: {
					assessmentType: "textResponse",
					question: "Reflect",
					gradingMode: "none",
					required: false,
					response: {},
				},
			},
		];
		const doc = new DOMParser().parseFromString(render(config), "text/html");
		for (const id of ["praxity-host-config", "praxity-config"]) {
			const raw = JSON.parse(doc.getElementById(id)?.textContent ?? "{}");
			const admitted = admitChoiceStateFacts(raw);
			expect(admitted.choiceStateFactsStatus).toBe("valid");
			expect(admitted.choiceStateInvalidIds).toEqual([]);
			expect(raw.choiceStateQuestions).toEqual({});
			expect(raw.choiceStateGroups).toEqual({
				g: { mode, memberIds: ["reflection"], requiredIds: ["reflection"] },
			});
		}
	},
);

it.each([
	["leadership", "valid"],
	["toolkit", "absent"],
	["comprehensive", "valid"],
] as const)("admits both compiled configs on every %s fixture page", async (name, status) => {
	const input = await compilerFixture(name);
	const config: CourseConfig = {
		id: input.id,
		title: input.title,
		sourceLocale: input.sourceLocale,
		pages: input.content,
		totalPages: input.content.length,
		moduleDeck: input.moduleDeck,
	};
	const prepared = prepareHtmlCourse(config, compilerIslandAssets);
	const documentSlugs = prepared.deckPages
		? [...new Set(prepared.deckPages.map((page) => page.moduleSlug))]
		: prepared.slugList.map((page) => page.slug);
	expect(documentSlugs.length).toBeGreaterThan(0);
	for (const slug of documentSlugs) {
		const doc = new DOMParser().parseFromString(
			renderHtmlDocument(prepared, slug, { islandAssets: compilerIslandAssets }, () => ""),
			"text/html",
		);
		for (const id of ["praxity-host-config", "praxity-config"]) {
			const script = doc.getElementById(id);
			expect(script).not.toBeNull();
			const admitted = admitChoiceStateFacts(JSON.parse(script?.textContent ?? "{}"));
			expect(admitted.choiceStateFactsStatus).toBe(status);
			expect(admitted.choiceStateInvalidIds).toEqual([]);
		}
	}
});

it("does not add empty group metadata to existing group-free packages", () => {
	const config = course();
	expect(prepareHtmlCourse(config).choiceFacts.choiceStateGroups).toBeUndefined();
	const doc = new DOMParser().parseFromString(render(config), "text/html");
	expect(
		JSON.parse(doc.getElementById("praxity-host-config")?.textContent ?? "{}").choiceStateGroups,
	).toBeUndefined();
});

it.each(["missing", "duplicate", "nested", "collision", "empty"])(
	"refuses %s compiled group dependencies",
	(fault) => {
		const config = groupedCourse("all");
		const group = config.pages[0].blocks[0];
		if (fault === "missing") group.data.memberBlockIds = ["missing"];
		if (fault === "duplicate") group.data.memberBlockIds = ["a", "a"];
		if (fault === "nested") group.data.memberBlockIds = ["g"];
		if (fault === "collision") {
			group.id = "a";
			group.data.memberBlockIds = ["ungraded"];
		}
		if (fault === "empty") group.id = "";
		expect(() => prepareHtmlCourse(config)).toThrow(/Invalid choice fact for block/);
	},
);

it("refuses conflicting group IDs across pages but permits an identical definition", () => {
	const config = groupedCourse("all");
	config.pages[1].blocks[0].id = "g";
	expect(() => prepareHtmlCourse(config)).toThrow(
		'Invalid choice fact for block "g": duplicate group ID',
	);
	config.pages[1].blocks = structuredClone(config.pages[0].blocks);
	expect(prepareHtmlCourse(config).choiceFacts.choiceStateGroups?.g).toEqual({
		mode: "all",
		memberIds: ["optional", "a", "ungraded", "private"],
		requiredIds: ["a", "ungraded", "private"],
	});
});

it("both config readers refuse corrupt groups without discarding unrelated questions", () => {
	document.documentElement.innerHTML = new DOMParser().parseFromString(
		render(groupedCourse("all")),
		"text/html",
	).documentElement.innerHTML;
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		for (const id of ["praxity-host-config", "praxity-config"]) {
			const script = scriptElement(id);
			const raw = JSON.parse(script.textContent ?? "{}");
			raw.choiceStateGroups = { g: { mode: "all", memberIds: ["a"], requiredIds: ["missing"] } };
			script.textContent = JSON.stringify(raw);
		}
		for (const facts of [
			readCourseHostConfig(document),
			admitChoiceStateFacts(readViewerConfig() as Record<string, unknown>),
		]) {
			expect(facts?.choiceStateFactsStatus).toBe("invalid");
			expect(facts?.choiceStateInvalidIds).toEqual(["g"]);
			expect(facts?.choiceStateQuestions?.a.selectionMode).toBe("single");
			expect(facts?.choiceStateGroups).toEqual({});
		}
	} finally {
		warn.mockRestore();
	}
});
it.each(["constructor", "toString", "__proto__"])(
	"a rejected %s pair cannot select an inherited value",
	(id) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const facts = admitChoiceStateFacts(
				JSON.parse(`{"choiceStateQuestions":{"${id}":{}},"choiceStateSignatures":{}}`),
			);
			expect(facts.choiceStateQuestions[id]).toBeUndefined();
			expect(facts.choiceStateSignatures[id]).toBeUndefined();
			expect(facts.choiceStateInvalidIds).toEqual([id]);
		} finally {
			warn.mockRestore();
		}
	},
);
it.each([
	["selectionMode", undefined],
	["attempts", 2.5],
	["attempts", "2"],
] as const)("refuses invalid raw %s value %j before rendering", (field, value) => {
	const config = course();
	const block = choice(config);
	if (field === "selectionMode")
		delete (block.data.response as Record<string, unknown>).selectionMode;
	else block.data[field] = value;
	const diagnostic = `Invalid choice fact for block "${block.id}": ${field}`;
	expect(() => render(config)).toThrow(diagnostic);
	expect(() => prepareHtmlCourse(config)).toThrow(diagnostic);
});
it("validates a raw assessment using the renderer's default choice type", () => {
	const config = course();
	const block = choice(config);
	delete block.data.assessmentType;
	delete (block.data.response as Record<string, unknown>).selectionMode;
	expect(() => render(config)).toThrow(
		`Invalid choice fact for block "${block.id}": selectionMode`,
	);
});
it.each([undefined, null, 0])("publishes valid defaults and attempts %s", (attempts) => {
	const config = course();
	const block = choice(config);
	if (attempts !== undefined) block.data.attempts = attempts;
	const doc = new DOMParser().parseFromString(render(config), "text/html");
	const host = readCourseHostConfig(doc) as unknown as {
		choiceStateQuestions: Record<string, { maxAttempts: number }>;
	};
	expect(host.choiceStateQuestions[block.id].maxAttempts).toBe(0);
});
it("retains the graded default and the policy owner's reveal override", () => {
	for (const settings of [
		{ gradingMode: "exact" },
		{ gradingMode: "none", attempts: 5, feedbackMode: "reveal" },
	]) {
		const config = course();
		const block = choice(config);
		Object.assign(block.data, settings);
		const doc = new DOMParser().parseFromString(render(config), "text/html");
		expect(readCourseHostConfig(doc)?.choiceStateQuestions?.[block.id].maxAttempts).toBe(1);
	}
});
it("retains document bytes apart from the two inert fields", () => {
	const html = render();
	const stripped = stripChoiceStateFacts(html);
	expect(createHash("sha256").update(stripped).digest("hex")).toBe(
		"a8952828a579eb755051a4ceacfba28d6c37bd55efe36b61a5094d1381cbc242",
	);
	expect(html).not.toMatch(/_inlineTrees|_htmlFields|referenceTrivia|generatedBy/);
});

it.each([
	"fact",
	"half",
	"mismatched ID",
	"extension",
	"signature",
	"question signature",
	"option signature",
])("isolates corrupt %s in both readers", (corruption) => {
	const config = course();
	const bad = choice(config);
	const good = structuredClone(bad);
	good.id = "unaffected";
	config.pages[0].blocks.push(good);
	document.documentElement.innerHTML = new DOMParser().parseFromString(
		render(config),
		"text/html",
	).documentElement.innerHTML;
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		for (const scriptId of ["praxity-host-config", "praxity-config"]) {
			const script = scriptElement(scriptId);
			const value = JSON.parse(script.textContent ?? "{}");
			if (corruption === "fact") value.choiceStateQuestions[bad.id].maxAttempts = 2.5;
			if (corruption === "signature")
				value.choiceStateSignatures[bad.id] = `sha256:${"d".repeat(64)}`;
			if (corruption === "question signature")
				value.choiceStateQuestions[bad.id].content.text = `sha256:${"d".repeat(64)}`;
			if (corruption === "option signature")
				value.choiceStateQuestions[bad.id].options[0].content.text = `sha256:${"d".repeat(64)}`;
			if (corruption === "half") delete value.choiceStateSignatures[bad.id];
			if (corruption === "mismatched ID") {
				value.choiceStateSignatures.extra = value.choiceStateSignatures[bad.id];
				delete value.choiceStateSignatures[bad.id];
			}
			if (corruption === "extension") value.choiceStateQuestions = "broken";
			script.textContent = JSON.stringify(value);
		}
		const host = readCourseHostConfig(document);
		expect(readCoreCourseConfig(document)?.courseId).toBe("course");
		const island = admitChoiceStateFacts(readViewerConfig() as Record<string, unknown>);
		expect(host?.courseId).toBe("course");
		for (const admitted of [host, island]) {
			expect(admitted?.choiceStateFactsStatus).toBe("invalid");
			expect(admitted?.choiceStateQuestions?.[bad.id]).toBeUndefined();
			expect(admitted?.choiceStateSignatures?.[bad.id]).toBeUndefined();
			if (corruption !== "extension") {
				expect(admitted?.choiceStateQuestions?.unaffected.selectionMode).toBe("single");
				expect(admitted?.choiceStateSignatures?.unaffected).toMatch(/^s96:/);
			}
		}
		expect(warn).toHaveBeenCalledWith(
			`Invalid choice facts for ID "${corruption === "extension" ? "*" : bad.id}"`,
		);
		const script = scriptElement("praxity-host-config");
		script.textContent = JSON.stringify({
			...JSON.parse(script.textContent ?? "{}"),
			courseId: 123,
		});
		expect(readCourseHostConfig(document)).toBeNull();
	} finally {
		warn.mockRestore();
	}
});

it("distinguishes older packages from invalid facts", () => {
	document.documentElement.innerHTML = new DOMParser().parseFromString(
		render(),
		"text/html",
	).documentElement.innerHTML;
	for (const id of ["praxity-host-config", "praxity-config"]) {
		const script = scriptElement(id);
		const value = JSON.parse(script.textContent ?? "{}");
		delete value.choiceStateQuestions;
		delete value.choiceStateSignatures;
		script.textContent = JSON.stringify(value);
	}
	expect(readCourseHostConfig(document)?.choiceStateFactsStatus).toBe("absent");
	expect(
		admitChoiceStateFacts(readViewerConfig() as Record<string, unknown>).choiceStateFactsStatus,
	).toBe("absent");
});

it("computes each pair once for all documents", () => {
	const config = course();
	config.pages.push({ id: "second", title: "Second", blocks: [] });
	config.totalPages = 2;
	const compute = vi.spyOn(choiceCompiler, "choiceStateQuestion");
	try {
		const prepared = prepareHtmlCourse(config, compilerIslandAssets);
		expect(compute).toHaveBeenCalledTimes(1);
		for (const { slug } of prepared.slugList) {
			const html = renderHtmlDocument(
				prepared,
				slug,
				{ islandAssets: compilerIslandAssets },
				() => "",
			);
			const doc = new DOMParser().parseFromString(html, "text/html");
			expect(readCourseHostConfig(doc)?.choiceStateQuestions).toEqual(
				prepared.choiceFacts.choiceStateQuestions,
			);
		}
		expect(compute).toHaveBeenCalledTimes(1);
	} finally {
		compute.mockRestore();
	}
});

it("projects admitted questions and options to their public fields", () => {
	const doc = new DOMParser().parseFromString(render(), "text/html");
	const value = JSON.parse(doc.getElementById("praxity-host-config")?.textContent ?? "{}");
	const id = Object.keys(value.choiceStateQuestions)[0];
	const original = structuredClone(value.choiceStateQuestions[id]);
	value.choiceStateQuestions[id].evil = "not public";
	value.choiceStateQuestions[id].options[0].evil = "not public";
	expect(admitChoiceStateFacts(value).choiceStateQuestions[id]).toEqual(original);
});

it("raw HTML option footnotes keep their source text in compiler facts", () => {
	const signature = (note: string) => {
		const config = course();
		const block = choice(config);
		const response = block.data.response as { options: Record<string, unknown>[] };
		response.options[0] = { id: "a", isCorrect: true, label: `<span>Yes @footer{${note}}</span>` };
		const facts = prepareHtmlCourse(config).choiceFacts;
		expect(facts.choiceStateQuestions[block.id].options[0].content.text).toBe(
			`Yes @footer{${note}}`,
		);
		return facts.choiceStateSignatures[block.id];
	};
	expect(signature("Old")).not.toBe(signature("New"));
});
