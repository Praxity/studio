import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson, readWriteDistractorsContent } from "@praxity/grammar";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import { writeDistractorsContentRevision } from "@praxity/shared-blocks/write-distractors-content";
import { afterAll, beforeAll, expect, it } from "vitest";
import { projectText } from "../../../../apps/desktop/src/main/export/inspect-project-v1";
import {
	compileCourse,
	compilePage,
	createCourseContext,
	renderNode,
	writeDistractorsContentInput,
} from "../build";
import { generateHtmlPages } from "../html-pages";
import { narrationPlaylistFromConfig } from "../narration-playlist";
import {
	createCourseContextFromHtml,
	getPageDependencies,
	refreshCourseContext,
} from "../preview/course-context";
import {
	admitWriteDistractorsRuntime,
	captureWriteDistractorsRuntime,
	writeDistractorsPageAssets,
	writeDistractorsRuntimeAssets,
	writeWriteDistractorsAssets,
} from "../write-distractors";

const capturedOutput = {
	islandAssets: {
		loaderFilename: "loader.js",
		selfCheckLifetime: "lifetime.js",
		writeDistractorsCss: "write-distractors.css",
		islandFilenames: Object.fromEntries(
			["deck", "nav", "accordion", "tabs", "card", "tooltip", "writeDistractors"].map((name) => [
				name,
				`${name}.js`,
			]),
		),
	},
};
function serializeOutput(value: unknown): string {
	return JSON.stringify(value, (_key, value) => {
		if (value instanceof Map) return [...value.entries()];
		if (value instanceof Set) return [...value.values()];
		if (value instanceof Error)
			return { ...value, name: value.name, message: value.message, stack: value.stack };
		return value;
	});
}
function assertNoHidden(outputs: readonly unknown[], hidden: string): void {
	const json = JSON.stringify(hidden).slice(1, -1);
	const forms = [
		hidden,
		json,
		json
			.replaceAll("<", "\\u003c")
			.replace(
				/[\u007f-\uffff]/g,
				(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
			),
	];
	for (const output of outputs)
		for (const form of forms) expect(serializeOutput(output)).not.toContain(form);
}

const content = {
	question: "Question",
	rightAnswer: "RIGHT_A",
	count: 2,
	misconceptions: [{ id: "item", label: "LABEL_A" }],
	authorOptions: [{ text: "OPTION_A", misconception: "item" }],
};
function fixture(right = "RIGHT_A", label = "LABEL_A", option = "OPTION_A", prefix = "") {
	const read = readLesson(
		`# P\n::: write-distractors Question\nanswer: ${right}\n:: ${label}\noption: ${option}\n:::\n`,
		{
			ids: (node, role) =>
				!role && node.type === "write-distractors"
					? `${prefix}wd`
					: !role && node.kind === "item"
						? `${prefix}item`
						: `${prefix}${node.kind}-${node.span.start}-${role ?? "owner"}`,
		},
	);
	const block = read.blocks.find((block) => block.type === "writeDistractors");
	if (!block) throw new Error("Missing activity");
	return {
		id: "course",
		title: "Course",
		sourceLocale: "en",
		content: read.pages,
		writeDistractorsContents: [
			writeDistractorsContentInput(block.id, readWriteDistractorsContent(read, block.id)),
		],
	};
}
const config = (input: ReturnType<typeof fixture>) => ({
	...input,
	pages: input.content,
	totalPages: input.content.length,
});
let scratch: string;
let publication: Awaited<ReturnType<typeof compileCourse>>;
beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), "write-distractors-assets-"));
	publication = await compileCourse(fixture(), { temporaryRoot: scratch });
});
afterAll(async () => {
	await publication?.dispose();
	await rm(scratch, { recursive: true });
});

it("uses the frozen ordered revision and exact asset bytes, hash and manifest", async () => {
	const input = fixture();
	expect(input.writeDistractorsContents[0].content).toEqual(content);
	const context = await createCourseContext(input);
	const [asset] = writeDistractorsRuntimeAssets(context.writeDistractorsRuntime);
	const revision = "sha256:3b31eca7b3e27e41da78c16892c44209d85c30d3920746a9099a41251497ad89";
	const hash = "ea55d30024d3770c900fc1b0a24eec8cdf7c1fc8f05939b38861375538370e0d";
	const payload = { blockId: "wd", contentRevision: revision, content };
	const bytes = `globalThis.__praxityWriteDistractorsAsset?.(${JSON.stringify(payload)});\n`;
	expect(asset.contentRevision).toBe(revision);
	expect(asset.bytes.toString()).toBe(bytes);
	expect(asset.sha256).toBe(hash);
	expect(asset.path).toBe(`write-distractors/${hash}.js`);
	expect(asset.manifest).toEqual({
		path: asset.path,
		sha256: hash,
		byteLength: Buffer.byteLength(bytes),
		mediaType: "text/javascript; charset=utf-8",
	});
	const files = await writeWriteDistractorsAssets(context.writeDistractorsRuntime, scratch);
	expect(files).toEqual([asset.manifest]);
	expect(await readFile(join(scratch, asset.path))).toEqual(asset.bytes);
	const reference = { blockId: "wd", contentRevision: revision, path: asset.path, sha256: hash };
	expect(
		writeDistractorsPageAssets(context.writeDistractorsRuntime, context.pages[0].blocks),
	).toEqual([reference]);
	expect(context.pages[0].assetPaths).toContain(asset.path);
	expect((context.slices.assets?.value as Map<string, string> | undefined)?.get(asset.path)).toBe(
		revision,
	);
});

it("keeps authored item and option order in the revision", () => {
	const ordered = {
		...content,
		misconceptions: [...content.misconceptions, { id: "second", label: "SECOND_LABEL" }],
		authorOptions: [...content.authorOptions, { text: "SECOND_OPTION", misconception: "second" }],
	};
	const reversed = {
		...ordered,
		misconceptions: [...ordered.misconceptions].reverse(),
		authorOptions: [...ordered.authorOptions].reverse(),
	};
	expect(writeDistractorsContentRevision(ordered)).not.toBe(
		writeDistractorsContentRevision(reversed),
	);
	expect(ordered.misconceptions.map((item) => item.id)).toEqual(["item", "second"]);
});

it.each([
	["missing", (input: ReturnType<typeof fixture>) => ({ ...input, writeDistractorsContents: [] })],
	[
		"orphaned",
		(input: ReturnType<typeof fixture>) => ({
			...input,
			writeDistractorsContents: [{ ...input.writeDistractorsContents[0], blockId: "orphan" }],
		}),
	],
	[
		"duplicate",
		(input: ReturnType<typeof fixture>) => ({
			...input,
			writeDistractorsContents: [
				...input.writeDistractorsContents,
				...input.writeDistractorsContents,
			],
		}),
	],
	[
		"revision",
		(input: ReturnType<typeof fixture>) => ({
			...input,
			writeDistractorsContents: [{ ...input.writeDistractorsContents[0], contentRevision: "old" }],
		}),
	],
] as const)("refuses %s at fresh, captured and desktop compiler entries", async (kind, change) => {
	const input = change(fixture());
	const error = {
		code: `write-distractors-content-${kind}`,
		message: `write-distractors-content-${kind}`,
	};
	await expect(createCourseContext(input)).rejects.toMatchObject(error);
	await expect(
		createCourseContextFromHtml({ ...input, pages: input.content, totalPages: 1 }, {}),
	).rejects.toMatchObject(error);
	await expect(
		createCourseContext({
			courseId: "course",
			blocks: input.content.flatMap((p) => p.blocks),
			frontmatter: { title: "Course" },
			config: { completionThreshold: 100 },
			resolvedAssets: new Map(),
			writeDistractorsContents: input.writeDistractorsContents,
		} as never),
	).rejects.toMatchObject(error);
});
it.each(["question", "count", "items"])(
	"refuses stale public %s, duplicate block IDs and drafts",
	async (field) => {
		const input = fixture();
		const block = input.content[0].blocks.find((block) => block.type === "writeDistractors");
		if (!block) throw new Error("Missing prompt");
		const context = await createCourseContext(input);
		const changed = structuredClone(block);
		(changed.data.content as Record<string, unknown>)[field] =
			field === "question" ? "Changed" : field === "count" ? 3 : [{ id: "different" }];
		const error = expect.objectContaining({ code: "write-distractors-content-revision" });
		await expect(
			createCourseContext({ ...input, content: [{ ...input.content[0], blocks: [changed] }] }),
		).rejects.toThrowError(error);
		expect(() => renderNode(context, context.pages[0].id, block.id, changed)).toThrowError(error);
		await expect(
			createCourseContext({ ...input, content: [{ ...input.content[0], blocks: [block, block] }] }),
		).rejects.toMatchObject({ code: "write-distractors-content-duplicate" });
	},
);
it.each(["rightAnswer", "label", "option"])(
	"rejects a same-length %s change carrying the old revision",
	async (field) => {
		const input = fixture();
		const entry = input.writeDistractorsContents[0];
		if (field === "rightAnswer") entry.content.rightAnswer = "RIGHT_B";
		else if (field === "label") entry.content.misconceptions[0].label = "LABEL_B";
		else entry.content.authorOptions[0].text = "OPTION_B";
		await expect(createCourseContext(input)).rejects.toMatchObject({
			code: "write-distractors-content-revision",
			message: "write-distractors-content-revision",
		});
	},
);
it.each(["symbol", "nonenumerable", "getter", "prototype", "extra", "sparse", "unpaired", "blank"])(
	"closes content admission before cloning %s",
	async (kind) => {
		const input = fixture();
		const entry = input.writeDistractorsContents[0];
		let calls = 0;
		if (kind === "symbol") Object.assign(entry.content, { [Symbol("secret")]: "SECRET" });
		if (kind === "nonenumerable")
			Object.defineProperty(entry.content, "secret", { value: "SECRET" });
		if (kind === "getter")
			Object.defineProperty(entry.content, "rightAnswer", {
				enumerable: true,
				get() {
					calls++;
					throw new Error("SECRET");
				},
			});
		if (kind === "prototype") Object.setPrototypeOf(entry.content, { secret: "SECRET" });
		if (kind === "extra") Object.assign(entry.content.authorOptions[0], { secret: "SECRET" });
		if (kind === "sparse") delete entry.content.misconceptions[0];
		if (kind === "unpaired")
			entry.content.authorOptions.push({ text: "SECOND", misconception: "item" });
		if (kind === "blank") entry.content.rightAnswer = "   ";
		await expect(createCourseContext(input)).rejects.toMatchObject({
			code: "write-distractors-content-invalid",
			message: "write-distractors-content-invalid",
		});
		expect(calls).toBe(0);
	},
);
it("captures independent assets and dependencies across hidden edits and late older reads", async () => {
	const sibling = fixture("SIBLING_RIGHT", "SIBLING_LABEL", "SIBLING_OPTION", "sibling-");
	const combine = (input: ReturnType<typeof fixture>) => ({
		...input,
		content: [...input.content, ...sibling.content],
		writeDistractorsContents: [
			...input.writeDistractorsContents,
			...sibling.writeDistractorsContents,
		],
	});
	const input = combine(fixture());
	const first = await createCourseContext(input);
	const second = await refreshCourseContext(first, combine(fixture("RIGHT_B")), {});
	const third = await refreshCourseContext(
		second,
		combine(fixture("RIGHT_B", "LABEL_B", "OPTION_B")),
		{},
	);
	const asset = (context: typeof first) =>
		writeDistractorsRuntimeAssets(context.writeDistractorsRuntime)[0];
	expect(first.pages[0].blocks).toEqual(second.pages[0].blocks);
	expect(asset(first).contentRevision).not.toBe(asset(second).contentRevision);
	expect(asset(second).path).not.toBe(asset(third).path);
	expect(first.pages[0].sourceDigest).not.toBe(second.pages[0].sourceDigest);
	expect(getPageDependencies(first, first.pages[0].id, "fragments")).not.toEqual(
		getPageDependencies(second, second.pages[0].id, "fragments"),
	);
	expect(first.slices[first.pages[0].lessonKey]?.digest).not.toBe(
		second.slices[second.pages[0].lessonKey]?.digest,
	);
	expect(first.pages[1].sourceDigest).toBe(third.pages[1].sourceDigest);
	expect(writeDistractorsPageAssets(third.writeDistractorsRuntime, third.pages[1].blocks)).toEqual(
		writeDistractorsPageAssets(first.writeDistractorsRuntime, first.pages[1].blocks),
	);
	expect(first.pages[1].assetPaths).not.toContain(asset(first).path);
	expect(second.pages[0].assetPaths).not.toContain(asset(first).path);
	expect(
		(second.slices.assets?.value as Map<string, string> | undefined)?.has(asset(first).path),
	).toBe(false);
	input.writeDistractorsContents[0].content.rightAnswer = "MUTATED";
	const oldBytes = asset(first).bytes.toString();
	expect(oldBytes).toContain("RIGHT_A");
	expect(oldBytes).not.toContain("MUTATED");
	const returned = asset(first);
	returned.bytes.fill(0);
	expect(asset(first).bytes.toString()).toBe(oldBytes);
	const latest = await refreshCourseContext(
		third,
		combine(fixture("RIGHT_B", "LABEL_B", "OPTION_B")),
		{},
	);
	expect(latest.pages[0].sourceDigest).toBe(third.pages[0].sourceDigest);
	expect(asset(latest).path).toBe(asset(third).path);
	const captured = await createCourseContextFromHtml(
		config(combine(fixture())),
		capturedOutput,
		first.selfCheckRuntime,
		first.writeDistractorsRuntime,
	);
	expect(asset(captured).path).toBe(asset(first).path);
});
it("scans in-memory contexts and collectors for hidden bytes", async () => {
	const inputs = [
		fixture("HIDDEN_RIGHT café <x> 😀", "HIDDEN_LABEL déjà", "HIDDEN_OPTION </script>"),
		fixture("OTHER_RIGHT", "OTHER_LABEL", "OTHER_OPTION", "other-"),
	];
	const input = {
		...inputs[0],
		content: inputs
			.flatMap((x) => x.content)
			.map((page) => ({
				...page,
				narrationEnabled: true,
				data: {
					...page.data,
					_narrationSegments: extractNarrationSegments(
						page.title,
						page.data ?? {},
						page.blocks,
						{},
						"en",
					),
				},
			})),
		writeDistractorsContents: inputs.flatMap((x) => x.writeDistractorsContents),
	};
	const context = await createCourseContext(input);
	const assets = writeDistractorsRuntimeAssets(context.writeDistractorsRuntime);
	await writeWriteDistractorsAssets(context.writeDistractorsRuntime, scratch);
	const files = await readdir(join(scratch, "write-distractors"));
	const publicOutputs: unknown[] = [
		context,
		context.pages,
		context.slices,
		context.documents,
		context.normalizedCourse,
		...context.pages.flatMap((page) => [
			writeDistractorsPageAssets(context.writeDistractorsRuntime, page.blocks),
			...(
				[
					"fragments",
					"shell",
					"page-frame",
					"deck-outline",
					"glossary-document",
					"reading-script",
					"working-directory",
				] as const
			).map((consumer) => getPageDependencies(context, page.id, consumer)),
			extractNarrationSegments(page.title, page.data ?? {}, page.blocks, {}, "en"),
			narrationPlaylistFromConfig({
				narrationEnabled: true,
				grammarVersion: 4,
				narrationSegments: extractNarrationSegments(
					page.title,
					page.data ?? {},
					page.blocks,
					{},
					"en",
				).map((segment) => ({ ...segment, audioUrl: `voice/${segment.id}.mp3` })),
			}),
			page.blocks.map((block) => projectText(block, block.id, null)),
		]),
	];
	// Exercise each refusal with authored markers still present in the private input.
	const failures = [
		() => createCourseContext({ ...input, writeDistractorsContents: [] }),
		() =>
			createCourseContext({
				...input,
				writeDistractorsContents: [
					...input.writeDistractorsContents,
					input.writeDistractorsContents[0],
				],
			}),
		() =>
			createCourseContext({
				...input,
				writeDistractorsContents: [{ ...input.writeDistractorsContents[0], blockId: "orphan" }],
			}),
		() =>
			createCourseContext({
				...input,
				writeDistractorsContents: [
					{ ...input.writeDistractorsContents[0], contentRevision: "old" },
				],
			}),
		() =>
			createCourseContext({
				...input,
				writeDistractorsContents: [
					{
						...input.writeDistractorsContents[0],
						content: {
							...input.writeDistractorsContents[0].content,
							unexpected: "HIDDEN_RIGHT café <x> 😀",
						},
					},
				],
			} as never),
		() =>
			createCourseContextFromHtml(
				{
					...config(input),
					writeDistractorsContents: [
						{ ...input.writeDistractorsContents[0], contentRevision: "old" },
					],
				},
				capturedOutput,
			),
		() => refreshCourseContext(context, { ...input, writeDistractorsContents: [] }, {}),
		() => renderNode(context, context.pages[0].id, context.pages[0].blocks[0].id, undefined, []),
		() => generateHtmlPages(config(input), join(scratch, "scan-refusal")),
	];
	for (const action of failures) {
		let caught: unknown;
		try {
			await action();
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(Error);
		publicOutputs.push(caught);
	}

	for (const [index, item] of inputs.entries()) {
		const full = item.writeDistractorsContents[0].content;
		const own = assets[index];
		expect([...own.bytes].every((byte) => byte < 128)).toBe(true);
		expect(createHash("sha256").update(own.bytes).digest("hex")).toBe(own.sha256);
		const payload = JSON.parse(
			own.bytes.toString().slice("globalThis.__praxityWriteDistractorsAsset?.(".length, -3),
		);
		expect(payload.content).toEqual(full);
		for (const hidden of [
			full.rightAnswer,
			full.misconceptions[0].label,
			full.authorOptions[0].text,
		]) {
			assertNoHidden(publicOutputs, hidden);
			for (const file of files)
				if (file !== own.path.split("/")[1]) {
					const output = await readFile(join(scratch, "write-distractors", file), "utf8");
					assertNoHidden([output], hidden);
				}
		}
	}
	expect(serializeOutput(publicOutputs)).toContain("Question");
	expect(serializeOutput(context.slices.narration)).toContain("Question");
	expect(
		serializeOutput(
			context.pages.flatMap((page) =>
				page.blocks.map((block) => projectText(block, block.id, null)),
			),
		),
	).toContain("Question");
	expect(serializeOutput(publicOutputs)).toContain("voice/");
	expect(serializeOutput(context.slices.assets)).toContain(assets[0].path);
	expect(writeDistractorsContentRevision(content)).not.toBe(
		writeDistractorsContentRevision({ ...content, rightAnswer: "RIGHT_B" }),
	);
});
it("the hidden-byte scan detects nested Map, Set and error leaks", () => {
	const stackOnly = new Error("Public");
	stackOnly.stack = "SECRET";
	for (const output of [
		new Map([["public", new Set(["SECRET"])]]),
		new Set([new Map([["SECRET", "public"]])]),
		new Error("SECRET"),
		stackOnly,
	])
		expect(() => assertNoHidden([output], "SECRET")).toThrow();
});

it.each(["add", "duplicate", "drop"])("refuses a draft that would %s an activity", async (kind) => {
	const input = fixture();
	const context = await createCourseContext(input);
	const page = context.pages[0];
	const block = page.blocks.find((block) => block.type === "writeDistractors");
	if (!block) throw new Error("Missing activity");
	const blocks =
		kind === "add"
			? [...page.blocks, { ...structuredClone(block), id: "new-activity" }]
			: kind === "duplicate"
				? [...page.blocks, block]
				: page.blocks.filter((candidate) => candidate.id !== block.id);
	expect(() => renderNode(context, page.id, page.blocks[0].id, undefined, blocks)).toThrowError(
		expect.objectContaining({
			code: `write-distractors-content-${kind === "add" ? "missing" : kind === "drop" ? "orphaned" : "duplicate"}`,
		}),
	);
});

it("retains invalid-source diagnostics and skips only refused activities during admission", async () => {
	const invalid = readLesson(
		"# P\n::: write-distractors Question\nanswer: \n:: Label\noption: Option\n:::\n",
		{
			ids: (node, role) =>
				!role && node.type === "write-distractors"
					? "invalid-wd"
					: `invalid-${node.kind}-${node.span.start}-${role ?? "owner"}`,
		},
	);
	const block = invalid.blocks.find((block) => block.type === "writeDistractors");
	if (!block) throw new Error("Missing invalid activity");
	expect(() => readWriteDistractorsContent(invalid, block.id)).toThrowError(
		expect.objectContaining({ code: "write-distractors-content-invalid" }),
	);
	const sibling = fixture("SIBLING_RIGHT", "SIBLING_LABEL", "SIBLING_OPTION", "sibling-");
	const pages = [...invalid.pages, ...sibling.content];
	const runtime = captureWriteDistractorsRuntime(sibling);
	const admitted = admitWriteDistractorsRuntime(pages, runtime, new Set([block.id]));
	expect(writeDistractorsRuntimeAssets(admitted).map((asset) => asset.blockId)).toEqual([
		"sibling-wd",
	]);
	expect(
		writeDistractorsRuntimeAssets(admitWriteDistractorsRuntime(pages, admitted)).map(
			(asset) => asset.blockId,
		),
	).toEqual(["sibling-wd"]);
	const unresolvedNodes = new Map([[block.id, { code: "invalid-source" as const, line: 2 }]]);
	const context = await createCourseContext({ ...sibling, content: pages, unresolvedNodes });
	expect(context.unresolvedNodes?.get(block.id)).toEqual({ code: "invalid-source", line: 2 });
	expect(context.pages[0].assetPaths).toEqual([]);
	expect(
		writeDistractorsRuntimeAssets(context.writeDistractorsRuntime).map((asset) => asset.blockId),
	).toEqual(["sibling-wd"]);
	expect(() =>
		admitWriteDistractorsRuntime(
			[{ ...invalid.pages[0], blocks: [block, block] }],
			captureWriteDistractorsRuntime({}),
			new Set([block.id]),
		),
	).toThrowError(expect.objectContaining({ code: "write-distractors-content-duplicate" }));
	expect(() =>
		admitWriteDistractorsRuntime(invalid.pages, runtime, new Set([block.id])),
	).toThrowError(expect.objectContaining({ code: "write-distractors-content-orphaned" }));
	const refusedValid = admitWriteDistractorsRuntime(
		sibling.content,
		runtime,
		new Set(["sibling-wd"]),
	);
	expect(
		writeDistractorsRuntimeAssets(admitWriteDistractorsRuntime(sibling.content, refusedValid)),
	).toEqual([]);
	const invalidOnly = await createCourseContext({
		...sibling,
		content: invalid.pages,
		writeDistractorsContents: [],
		unresolvedNodes,
	});
	expect(invalidOnly.unresolvedNodes?.get(block.id)).toEqual({ code: "invalid-source", line: 2 });
	expect(writeDistractorsRuntimeAssets(invalidOnly.writeDistractorsRuntime)).toEqual([]);
});

it("rejects outer content accessors before fresh, refresh and captured context copies", async () => {
	const input = fixture();
	const previous = await createCourseContext(input);
	let calls = 0;
	const hostile = {
		...input,
		get writeDistractorsContents(): never {
			calls++;
			throw new Error("SECRET");
		},
	};
	const expected = {
		code: "write-distractors-content-invalid",
		message: "write-distractors-content-invalid",
	};
	await expect(createCourseContext(hostile)).rejects.toMatchObject(expected);
	await expect(refreshCourseContext(previous, hostile, {})).rejects.toMatchObject(expected);
	const captured = {
		...config(input),
		get writeDistractorsContents(): never {
			calls++;
			throw new Error("SECRET");
		},
	};
	await expect(createCourseContextFromHtml(captured, {})).rejects.toMatchObject(expected);
	await expect(
		createCourseContextFromHtml(
			captured,
			{},
			previous.selfCheckRuntime,
			previous.writeDistractorsRuntime,
		),
	).rejects.toMatchObject(expected);
	expect(calls).toBe(0);
});

it.each(["fresh", "refresh", "captured", "draft"])(
	"retains a single discriminator read through asset admission at %s",
	async (entry) => {
		const input = fixture();
		const activity = input.content[0].blocks.find((block) => block.type === "writeDistractors");
		if (!activity) throw new Error("Missing activity");
		let reads = 0;
		Object.defineProperty(activity, "type", {
			enumerable: true,
			get() {
				return ++reads === 1 ? "writeDistractors" : "divider";
			},
		});
		if (entry === "draft") {
			const previous = await createCourseContext(fixture());
			expect(renderNode(previous, previous.pages[0].id, activity.id, activity)).toBeDefined();
		} else {
			const context =
				entry === "fresh"
					? await createCourseContext(input)
					: entry === "captured"
						? await createCourseContextFromHtml(config(input), capturedOutput)
						: await refreshCourseContext(await createCourseContext(fixture()), input, {});
			expect(context.pages[0].blocks.find((block) => block.id === activity.id)?.type).toBe(
				"writeDistractors",
			);
			expect(
				writeDistractorsRuntimeAssets(context.writeDistractorsRuntime).map(
					(asset) => asset.blockId,
				),
			).toEqual([activity.id]);
		}
		expect(reads).toBe(1);
	},
);

it("publishes captured content only through the activity asset", async () => {
	const input = fixture();
	const context = await createCourseContext(input);
	const page = compilePage(context, context.pages[0].id);
	expect(JSON.stringify(page)).toContain("Question");
	assertNoHidden([page], "RIGHT_A");
	expect(
		publication.manifest.files.some((file) => file.path.startsWith("write-distractors/")),
	).toBe(true);
});
