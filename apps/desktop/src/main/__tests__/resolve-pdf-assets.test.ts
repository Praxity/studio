import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CoursePdfLesson } from "@praxity/format-renderers/pipelines/course-pdf";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolvePdfAssets } from "../export/resolve-pdf-assets";

let root: string;
let project: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "praxity-pdf-assets-"));
	project = path.join(root, "project");
	await mkdir(path.join(project, "assets"), { recursive: true });
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const image = (src: string, id = "image"): PraxityBlock => ({
	id,
	type: "image",
	data: { src, alt: "An informative diagram" },
});
const lessons = (blocks: PraxityBlock[]): CoursePdfLesson[] => [
	{ id: "lesson", title: "Assets", locale: "en", blocks },
];

it("reads only included images, including feedback only with the answer sheet", async () => {
	await writeFile(path.join(project, "assets", "visible.png"), "visible bytes");
	const blocks: PraxityBlock[] = [
		image("/assets/visible.png"),
		{ ...image("/assets/hidden.png", "hidden"), visible: false },
		{
			id: "question",
			type: "assessment",
			data: {
				stem: [{ id: "prompt", type: "text", data: { content: "Pick one." } }],
				response: {
					type: "choice",
					selectionMode: "single",
					options: [
						{ id: "a", label: "A", isCorrect: true },
						{ id: "b", label: "B", isCorrect: false },
					],
				},
				feedback: { correct: [image("/assets/feedback.png", "feedback")] },
			},
		},
	];
	const handout = await resolvePdfAssets(project, lessons(blocks), false);
	expect([...handout.keys()]).toEqual(["/assets/visible.png"]);
	expect(Buffer.from(handout.get("/assets/visible.png") ?? []).toString()).toBe("visible bytes");
	await expect(resolvePdfAssets(project, lessons(blocks), true)).rejects.toMatchObject({
		code: "ENOENT",
	});
	await writeFile(path.join(project, "assets", "feedback.png"), "feedback bytes");
	expect([...(await resolvePdfAssets(project, lessons(blocks), true)).keys()]).toEqual([
		"/assets/visible.png",
		"/assets/feedback.png",
	]);
});

it.each([
	"assets/../outside.png",
	"/assets/%2e%2e/outside.png",
	"outside.png",
	"assets/dir\\outside.png",
])("rejects invalid asset reference %s", async (reference) => {
	await expect(resolvePdfAssets(project, lessons([image(reference)]), false)).rejects.toThrow(
		/assets directory|traversal/,
	);
});

it("rejects missing required images and symlinks outside the assets directory", async () => {
	await expect(
		resolvePdfAssets(project, lessons([image("assets/missing.png")]), false),
	).rejects.toMatchObject({ code: "ENOENT" });
	const outside = path.join(root, "outside.png");
	await writeFile(outside, "outside bytes");
	await symlink(outside, path.join(project, "assets", "escaped.png"));
	await expect(
		resolvePdfAssets(project, lessons([image("assets/escaped.png")]), false),
	).rejects.toThrow("Path traversal blocked");
});

it("rejects an assets directory symlink outside the project", async () => {
	await rm(path.join(project, "assets"), { recursive: true });
	const outside = path.join(root, "outside-assets");
	await mkdir(outside);
	await writeFile(path.join(outside, "outside.png"), "outside bytes");
	await symlink(outside, path.join(project, "assets"));
	await expect(
		resolvePdfAssets(project, lessons([image("assets/outside.png")]), false),
	).rejects.toThrow("Path traversal blocked");
});
