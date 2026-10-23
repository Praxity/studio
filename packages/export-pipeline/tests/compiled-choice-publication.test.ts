import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCoursePracticeAdmission, readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { compileCourse, preparePublicationContext } from "../src/build";
import type { CourseConfig } from "../src/html-gen";

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
function choice(config: CourseConfig) {
	const block = config.pages[0].blocks.find((block) => block.type === "assessment");
	if (!block) throw Error("Missing choice");
	return block;
}

it.each([
	["attempts", 2.5],
	["attempts", "2"],
	["selectionMode", undefined],
] as const)(
	"refuses publication before replacing last-good output for %s %s",
	async (field, value) => {
		const config = course();
		const block = choice(config);
		if (field === "selectionMode")
			delete (block.data.response as Record<string, unknown>).selectionMode;
		else block.data.attempts = value;
		const root = await mkdtemp(join(tmpdir(), "choice-refusal-"));
		try {
			await writeFile(join(root, "last-good.html"), "last good learner output");
			await expect(
				compileCourse(
					{
						id: config.id,
						title: config.title,
						sourceLocale: config.sourceLocale,
						content: config.pages,
					},
					{ temporaryRoot: root },
				),
			).rejects.toThrow(`Invalid choice fact for block "${block.id}": ${field}`);
			expect(await readdir(root)).toEqual(["last-good.html"]);
			expect(await readFile(join(root, "last-good.html"), "utf8")).toBe("last good learner output");
		} finally {
			await rm(root, { recursive: true });
		}
	},
);

it.each(["2.5", "'2'", "2"])(
	"admits only valid source attempts=%s at publication",
	async (attempts) => {
		let id = 0;
		const read = readLesson(
			`# Practice\n::: choice Pick one {attempts=${attempts}}\n(x) Yes\n( ) No\n:::\n`,
			{ ids: () => `source-${++id}` },
		);
		expect(read.errors.find((error) => error.attribute === "attempts")?.blockId).toBe(
			attempts === "2" ? undefined : "source-6",
		);
		const prepare = async () => {
			assertCoursePracticeAdmission([{ path: "lesson.prax", read }]);
			return preparePublicationContext({
				id: "course",
				title: "Practice",
				sourceLocale: "en",
				content: read.pages,
			});
		};
		if (attempts === "2") await expect(prepare()).resolves.toBeDefined();
		else
			await expect(prepare()).rejects.toThrow('Invalid choice fact for block "source-6": attempts');
	},
);
it("allows identical duplicate IDs across pages", async () => {
	const config = course();
	const second = structuredClone(config.pages[0]);
	second.id = "second";
	await expect(
		preparePublicationContext({
			id: "course",
			title: "Practice",
			sourceLocale: "en",
			content: [config.pages[0], second],
		}),
	).resolves.toBeDefined();
});
it("names a duplicate ID when its facts conflict across pages", async () => {
	const config = course();
	const second = structuredClone(config.pages[0]);
	second.id = "second";
	const duplicate = second.blocks.find((block) => block.type === "assessment");
	if (!duplicate) throw Error("Missing duplicate");
	duplicate.data.attempts = 2;
	await expect(
		preparePublicationContext({
			id: "course",
			title: "Practice",
			sourceLocale: "en",
			content: [config.pages[0], second],
		}),
	).rejects.toThrow(`Invalid choice fact for block "${duplicate.id}": duplicate ID`);
});
