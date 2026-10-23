import { readLesson, readWriteDistractorsContent } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	compileCourse,
	createCourseContext,
	renderNode,
	writeDistractorsContentInput,
} from "../build";
import { createCourseContextFromHtml } from "../preview/course-context";
import { sanitizeBlockForJson } from "../published-markup";
import { cloneAdmittedSelfCheckData, constructSelfCheckPromptData } from "../self-check-prompt";

const source =
	"# P\n::: write-distractors <b>PromptControl</b>\nanswer: W03_RIGHT_UNIQUE\n:: W03_LABEL_UNIQUE\noption: W03_OPTION_UNIQUE\n:::\n";
const block = () => {
	const result = readLesson(source).blocks.find((block) => block.type === "writeDistractors");
	if (!result) throw new Error("Missing distractors fixture");
	return result;
};
const invalid = {
	code: "EWRITEDISTRACTORSPROMPT",
	message: "Invalid write-distractors prompt data.",
};
const config = (blocks: PraxityBlock[]) => ({
	id: "course",
	title: "Course",
	sourceLocale: "en",
	totalPages: 1,
	pages: [{ id: "page", title: "P", blocks }],
});

it("keeps literal prompt data closed through JSON and captured Map/Set records", () => {
	const input = block();
	expect(sanitizeBlockForJson(input)).toEqual(input);
	expect(
		sanitizeBlockForJson({ id: "outer", type: "accordion", data: { children: [input] } }),
	).toEqual({ id: "outer", type: "accordion", data: { children: [input] } });
	const snapshot = { map: new Map([[input, new Set([input])]]) };
	const output = cloneAdmittedSelfCheckData(snapshot);
	const [[key, values]] = [...output.map];
	expect(key).toEqual(input);
	expect(key).not.toBe(input);
	expect([...values][0]).toBe(key);
	expect(JSON.stringify(key)).not.toMatch(/W03_RIGHT|W03_LABEL|W03_OPTION/);
});

it.each([
	"field",
	"symbol",
	"nonenumerable",
	"getter",
	"data-type-getter",
	"prototype",
	"inherited-type",
])("refuses %s before capture, sanitization and draft substitution", async (kind) => {
	const input = block();
	let getterCalls = 0;
	if (kind === "field") input.data.rightAnswer = "W03_RIGHT_UNIQUE";
	if (kind === "symbol") Object.assign(input.data, { [Symbol("answer")]: "W03_RIGHT_UNIQUE" });
	if (kind === "nonenumerable")
		Object.defineProperty(input.data, "rightAnswer", { value: "W03_RIGHT_UNIQUE" });
	if (kind === "getter")
		Object.defineProperty(input.data, "level", {
			enumerable: true,
			get() {
				getterCalls++;
				return 2;
			},
		});
	if (kind === "data-type-getter")
		Object.defineProperty(input.data, "type", {
			enumerable: true,
			get() {
				getterCalls++;
				return "ordinary";
			},
		});
	if (kind === "inherited-type") {
		Object.setPrototypeOf(input, { type: "writeDistractors" });
		Reflect.deleteProperty(input, "type");
	}

	if (kind === "prototype") Object.setPrototypeOf(input.data, { rightAnswer: "W03_RIGHT_UNIQUE" });
	for (const construct of [
		sanitizeBlockForJson,
		(value: PraxityBlock) =>
			sanitizeBlockForJson({ id: "outer", type: "accordion", data: { children: [value] } }),
		cloneAdmittedSelfCheckData,
		constructSelfCheckPromptData,
	])
		expect(() => construct(input)).toThrowError(expect.objectContaining(invalid));
	await expect(
		createCourseContext({
			id: "course",
			title: "Course",
			sourceLocale: "en",
			content: config([input]).pages,
		}),
	).rejects.toMatchObject(invalid);
	await expect(createCourseContextFromHtml(config([input]), {})).rejects.toMatchObject(invalid);
	const context = await createCourseContext({
		id: "ordinary",
		title: "Ordinary",
		sourceLocale: "en",
		content: config([{ id: input.id, type: "text", data: { content: "<p>Text</p>" } }]).pages,
	});
	expect(() => renderNode(context, "page", input.id, input)).toThrowError(
		expect.objectContaining(invalid),
	);
	expect(() => renderNode(context, "page", input.id, undefined, [input])).toThrowError(
		expect.objectContaining(invalid),
	);
	expect(getterCalls).toBe(0);
});

it("keeps direct prompt constructors strict about discriminator accessors", () => {
	let reads = 0;
	const input = Object.defineProperty(block(), "type", {
		enumerable: true,
		get() {
			reads++;
			return "writeDistractors";
		},
	});
	for (const construct of [sanitizeBlockForJson, constructSelfCheckPromptData])
		expect(() => construct(input)).toThrowError(expect.objectContaining(invalid));
	expect(reads).toBe(0);
});

it.each(["clone", "fresh", "captured", "draft"])(
	"routes a single captured discriminator before zero-read prompt validation at %s",
	async (entry) => {
		let typeReads = 0;
		let dataReads = 0;
		const input = Object.defineProperty(block(), "type", {
			enumerable: true,
			get() {
				return ++typeReads === 1 ? "writeDistractors" : "divider";
			},
		});
		Object.defineProperty(input.data, "level", {
			enumerable: true,
			get() {
				dataReads++;
				return 2;
			},
		});
		const attempt = async () => {
			if (entry === "clone") return cloneAdmittedSelfCheckData(input);
			if (entry === "captured") return createCourseContextFromHtml(config([input]), {});
			if (entry === "fresh")
				return createCourseContext({
					id: "course",
					title: "Course",
					sourceLocale: "en",
					content: config([input]).pages,
				});
			const context = await createCourseContext({
				id: "course",
				title: "Course",
				sourceLocale: "en",
				content: config([{ id: input.id, type: "divider", data: {} }]).pages,
			});
			return renderNode(context, "page", input.id, input);
		};
		await expect(attempt()).rejects.toMatchObject(invalid);
		expect(typeReads).toBe(1);
		expect(dataReads).toBe(0);
	},
);

it("retains the first discriminator and aliases in a cyclic compiler snapshot", () => {
	let reads = 0;
	const input = Object.defineProperty(block(), "type", {
		enumerable: true,
		get() {
			return ++reads === 1 ? "writeDistractors" : "divider";
		},
	});
	const snapshot: { block: PraxityBlock; alias: PraxityBlock; self?: unknown } = {
		block: input,
		alias: input,
	};
	snapshot.self = snapshot;
	const output = cloneAdmittedSelfCheckData(snapshot);
	expect(output.block.type).toBe("writeDistractors");
	expect(output.block.data).toEqual(input.data);
	expect(output.alias).toBe(output.block);
	expect(output.self).toBe(output);
	expect(reads).toBe(1);
	expect(Object.getOwnPropertyDescriptor(input, "type")?.get).toBeTypeOf("function");
});

it("preserves native clone values and refuses uncloneable metadata", () => {
	const bytes = new Uint8Array([3, 8]);
	const input = { date: new Date("2026-01-01Z"), bytes, alias: bytes, pattern: /prompt/g };
	const output = cloneAdmittedSelfCheckData(input);
	expect(output).toEqual(input);
	expect(output.bytes).not.toBe(bytes);
	expect(output.alias).toBe(output.bytes);
	for (const metadata of [new Proxy({}, {}), new WeakMap(), Promise.resolve("hidden")])
		expect(() => cloneAdmittedSelfCheckData({ metadata })).toThrowError(
			expect.objectContaining({
				code: "ECOMPILERCLONE",
				message: "Cannot capture compiler input.",
			}),
		);
});

let publication: Awaited<ReturnType<typeof compileCourse>>;
beforeAll(async () => {
	const read = readLesson(source);
	const activity = read.blocks.find((block) => block.type === "writeDistractors");
	if (!activity) throw new Error("Missing distractors fixture");
	publication = await compileCourse({
		id: "course",
		title: "Course",
		sourceLocale: "en",
		content: config([activity]).pages,
		writeDistractorsContents: [
			writeDistractorsContentInput(activity.id, readWriteDistractorsContent(read, activity.id)),
		],
	});
});
afterAll(async () => {
	await publication?.dispose();
});
it("publishes a valid prompt after closed admission", () => {
	expect(
		publication.manifest.files.some((file) => file.path.startsWith("write-distractors/")),
	).toBe(true);
});

it("preserves unrelated inherited type values in compiler metadata", () => {
	class Other {
		type = "ordinary";
		value = "kept";
	}
	Object.defineProperty(Other.prototype, "type", { value: "ordinary" });
	const input = new Other();
	Reflect.deleteProperty(input, "type");
	expect(cloneAdmittedSelfCheckData({ metadata: input })).toEqual({ metadata: { value: "kept" } });
});
it("reports unknown inherited type accessors as compiler capture errors without invoking them", () => {
	let calls = 0;
	class Other {
		value = "kept";
		get type() {
			calls++;
			return "ordinary";
		}
	}
	expect(() => cloneAdmittedSelfCheckData({ metadata: new Other() })).toThrowError(
		expect.objectContaining({ code: "ECOMPILERCLONE", message: "Cannot capture compiler input." }),
	);
	expect(calls).toBe(0);
});

it("requires the authored channel for a valid prompt after closed admission", async () => {
	await expect(
		createCourseContext({
			id: "course",
			title: "Course",
			sourceLocale: "en",
			content: config([block()]).pages,
		}),
	).rejects.toMatchObject({ code: "write-distractors-content-missing" });
});
