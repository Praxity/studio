import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const language of ["en", "fr"] as const) {
	test(`break-ui B ${language} explains refusals, keeps text and trims subject edges`, async ({
		page,
	}) => {
		const fr = language === "fr";
		const source = `${fr ? "---\nlang: fr\n---\n\n" : ""}# Page\n\n## Original\n\nKeep.\n`;
		const stop = await startJourney(page.context(), { standaloneSource: source });
		try {
			const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
			await page.goto(
				`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
			);
			await expect(page.getByRole("status")).toHaveText(fr ? "Connect\u00e9" : "Connected");
			for (const [kind, value, message] of [
				[
					"paragraph",
					"2026. Une ann\u00e9e",
					fr
						? "Cette ligne deviendrait un \u00e9l\u00e9ment de liste. Retirez le marqueur de liste pour la garder comme texte."
						: "This line would become a list item. Remove the list marker to keep it as text.",
				],
				[
					"paragraph",
					"1. Lisez",
					fr
						? "Cette ligne deviendrait un \u00e9l\u00e9ment de liste. Retirez le marqueur de liste pour la garder comme texte."
						: "This line would become a list item. Remove the list marker to keep it as text.",
				],
				[
					"heading",
					"Voir {page 3}",
					fr
						? "Les accolades deviendraient des param\u00e8tres du titre. Retirez les accolades pour garder ce contenu comme texte."
						: "Braces would become heading settings. Remove the braces to keep this as text.",
				],
			] as const) {
				await page
					.getByRole("button", {
						name:
							kind === "paragraph"
								? fr
									? "Modifier le paragraphe 1 : Keep."
									: "Edit paragraph 1: Keep."
								: fr
									? "Modifier le titre 2 : Original"
									: "Edit heading 2: Original",
						exact: true,
					})
					.click();
				const field = page.getByRole("textbox");
				await field.fill(value);
				await field.press("Enter");
				await expect(page.locator("#error:visible")).toHaveText(message);
				await expect(field).toHaveValue(value);
				await expect(field).toBeEditable();
				await expect(field).toHaveAttribute("aria-invalid", "true");
				await expect(
					page.getByRole("button", { name: fr ? "Recharger" : "Reload", exact: true }),
				).toBeHidden();
				await expect(field).toHaveAccessibleDescription(new RegExp(message.replace(/[.]/g, "\\.")));
				expect(await readFile(file, "utf8")).toBe(source);
				await field.press("Escape");
				await page
					.getByRole("button", { name: fr ? "Abandonner le texte" : "Discard text", exact: true })
					.click();
				await expect(field).toHaveCount(0);
			}
			let expected = source;
			for (const [old, text, normalized] of [
				["Original", "Name ", "Name"],
				["Name", " Name  with\ttabs", "Name  with\ttabs"],
			]) {
				await page
					.getByRole("button", {
						name: new RegExp(`^${fr ? "Modifier le titre 2 : " : "Edit heading 2: "}`),
					})
					.click();
				const field = page.getByRole("textbox");
				await field.fill(text);
				await field.press("Enter");
				await expect(field).toHaveCount(0);
				expected = expected.replace(`## ${old}`, `## ${normalized}`);
				expect(await readFile(file, "utf8")).toBe(expected);
				await expect(
					page.getByRole("heading", { name: normalized.replace(/\s+/g, " "), exact: true }),
				).toBeVisible();
			}
		} finally {
			await stop();
		}
	});
}
