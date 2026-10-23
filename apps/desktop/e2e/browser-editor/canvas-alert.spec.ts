import { readFile, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { projectDiskSnapshot } from "../../src/test-utils/interrupted-project-write";
import { startJourney } from "./global-setup";

for (const locale of ["en", "fr"] as const) {
	test(`linked store refusal names the folder and keeps text without Retry, ${locale}`, async ({
		page,
	}) => {
		const stop = await startJourney(page.context(), {
			standaloneSource: `---\nlang: ${locale}\ntitle: Practice\n---\n\n# Practice\n\nOriginal body.\n`,
		});
		const root = process.env.PRAXITY_BROWSER_PROJECT ?? "";
		const sidecar = join(root, ".praxity");
		const saved = join(root, "saved-store");
		let linked = false;
		try {
			await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
			await page
				.getByRole("button", {
					name: locale === "en" ? "Edit heading 1: Practice" : "Modifier le titre 1 : Practice",
					exact: true,
				})
				.click();
			const field = page.getByRole("textbox");
			await field.fill("Keep this exact text");
			const source = await readFile(join(root, "second.prax"));
			await rename(sidecar, saved);
			await symlink(saved, sidecar, "junction");
			linked = true;
			const before = await projectDiskSnapshot(saved);
			const reply = page.waitForResponse(
				async (response) =>
					response.url().endsWith("/api/rpc") &&
					response.request().postDataJSON().method === "canvasTextApply",
			);
			await field.press("Enter");
			const response = await reply;
			expect(response.status()).toBe(400);
			expect((await response.json()).error).toMatchObject({
				code: "EIDENTITY",
				messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: ".praxity" } },
			});
			const alert = page.locator("#error:visible");
			await expect(alert).toContainText(
				locale === "en"
					? "Studio needs a plain copy of .praxity"
					: "Studio a besoin d'une copie ordinaire de .praxity",
			);
			await expect(alert).toContainText("cp -R -L");
			await expect(alert).toContainText("Copy-Item -LiteralPath");
			await expect(field).toHaveValue("Keep this exact text");
			await expect(page.getByRole("button", { name: /Retry|Réessayer/u })).toHaveCount(0);
			expect(await projectDiskSnapshot(saved)).toEqual(before);
			expect(await readFile(join(root, "second.prax"))).toEqual(source);
		} finally {
			page.on("dialog", (dialog) => dialog.accept());
			await page.goto("about:blank");
			await stop();
			if (linked) {
				await rm(sidecar);
				await rename(saved, sidecar);
			}
		}
	});
}
