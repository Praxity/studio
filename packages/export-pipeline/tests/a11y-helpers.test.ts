import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { getCoursePages, readTestEnv } from "./a11y/helpers";

let directory: string;
let previousPath: string | undefined;
beforeEach(async () => {
	previousPath = process.env.PRAXITY_A11Y_ENV_PATH;
	directory = await mkdtemp(resolve(tmpdir(), "a11y-env-contract-"));
});
afterEach(async () => {
	if (previousPath === undefined) delete process.env.PRAXITY_A11Y_ENV_PATH;
	else process.env.PRAXITY_A11Y_ENV_PATH = previousPath;
	await rm(directory, { recursive: true, force: true });
});

test("independent invocation manifests never read each other's course", async () => {
	for (const [name, slug] of [
		["first", "alpha"],
		["second", "beta"],
	]) {
		const path = resolve(directory, `${name}.json`);
		await writeFile(
			path,
			JSON.stringify({ url: `http://localhost/${name}`, pages: [{ slug, title: slug }] }),
		);
		process.env.PRAXITY_A11Y_ENV_PATH = path;
		expect(readTestEnv().pages).toEqual([{ slug, title: slug }]);
	}
});

test("course metadata addresses the requested course without visiting another course", async () => {
	const root = "http://localhost/root";
	const variant = "http://localhost/variant";
	process.env.PRAXITY_A11Y_ENV_PATH = resolve(directory, "env.json");
	await writeFile(
		process.env.PRAXITY_A11Y_ENV_PATH,
		JSON.stringify({
			url: root,
			pages: [{ slug: "root-only", title: "Root" }],
			coursePages: { [variant]: [{ slug: "variant-only", title: "Variant" }] },
		}),
	);
	const unusedPage = {} as Page;
	expect(await getCoursePages(unusedPage, `${variant}/`)).toEqual([
		{ slug: "variant-only", title: "Variant" },
	]);
	expect(await getCoursePages(unusedPage, root)).toEqual([{ slug: "root-only", title: "Root" }]);
});

test("missing invocation metadata fails instead of consuming a stale shared file", () => {
	process.env.PRAXITY_A11Y_ENV_PATH = resolve(directory, "missing.json");
	expect(() => readTestEnv()).toThrow(/Missing or invalid test env/);
});
