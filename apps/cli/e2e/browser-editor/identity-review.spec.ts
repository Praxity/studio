import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { initializeCourseIdentity } from "../../src/main/identity-store";
import { startJourney } from "./global-setup";

async function identityBytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await identityBytes(root, file));
		else result[file] = (await readFile(join(root, file))).toString("base64");
	}
	return result;
}

for (const locale of ["en", "fr"] as const) {
	for (const duplicated of [false, true]) {
		test(`${locale} pending identity duplicate=${duplicated} preserves Read and every identity byte`, async ({
			browser,
			page,
		}) => {
			const fixture = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "identity-read-"),
			);
			let stop: (() => Promise<void>) | undefined;
			try {
				await writeFile(
					join(fixture, "course.yaml"),
					`title: Example\nlocale: ${locale}\nlessons: [first.prax]\n`,
				);
				await writeFile(
					join(fixture, "first.prax"),
					`# First\n\nDeleted body.\n\nRetained body.\n${duplicated ? "\nDuplicated body.\n" : ""}`,
				);
				await initializeCourseIdentity(fixture, ["first.prax"]);
				const source = `# First\n\nRetained body.\n${duplicated ? "\nDuplicated body.\n\nDuplicated body.\n" : ""}`;
				await writeFile(join(fixture, "first.prax"), source);
				const original = await identityBytes(join(fixture, ".praxity", "identity"));
				stop = await startJourney(browser, { courseFixture: fixture });
				const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
				await page.goto(ready);
				await expect(page.getByText("Retained body.", { exact: true })).toBeVisible();
				await expect(page.locator("form[action='/api/identity/confirm']")).toHaveCount(0);
				const project = process.env.PRAXITY_BROWSER_PROJECT ?? "";
				expect(await readFile(join(project, "first.prax"), "utf8")).toBe(source);
				expect(await identityBytes(join(project, ".praxity", "identity"))).toEqual(original);
			} finally {
				await page.goto("about:blank");
				await stop?.();
				await rm(fixture, { recursive: true });
			}
		});
	}
}
