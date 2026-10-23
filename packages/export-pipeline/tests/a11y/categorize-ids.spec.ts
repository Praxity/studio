import { expect, test } from "@playwright/test";
import { readTestEnv } from "./helpers";

test("published categorize ids stay valid and stable after answering and restoring", async ({
	page,
}) => {
	const url = readTestEnv().frenchMatrixUrls?.[0];
	if (!url) throw new Error("Missing French matrix fixture");
	await page.goto(url);
	const table = page.locator(".praxity-categorize-table");
	await expect(table.locator('xpath=ancestor::*[@data-island="assessment"]')).toHaveAttribute(
		"data-hydrated",
		"",
	);
	const inspect = () =>
		page.evaluate(() => {
			const rows = [...document.querySelectorAll(".praxity-categorize-table tbody th[id]")];
			const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
			const missing: string[] = [];
			for (const element of document.querySelectorAll(
				".praxity-block-assessment [aria-labelledby], .praxity-block-assessment [aria-describedby], .praxity-block-assessment [aria-controls], .praxity-block-assessment label[for]",
			)) {
				for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls", "for"])
					for (const id of element.getAttribute(attribute)?.split(/\s+/) ?? [])
						if (!document.getElementById(id)) missing.push(`${attribute}=${id}`);
			}
			return {
				rowIds: rows.map((row) => row.id).sort(),
				invalid: rows
					.filter((row) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(row.id))
					.map((row) => row.id),
				duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
				missing,
			};
		});
	const before = await inspect();
	expect(before.rowIds).toHaveLength(5);
	expect(before.invalid).toEqual([]);
	expect(before.duplicates).toEqual([]);
	expect(before.missing).toEqual([]);
	await table.getByRole("radio").first().check();
	expect(await inspect()).toEqual(before);
	await page.reload();
	await expect(table.locator('xpath=ancestor::*[@data-island="assessment"]')).toHaveAttribute(
		"data-hydrated",
		"",
	);
	expect(await inspect()).toEqual(before);
	await expect(table.locator("input:checked")).toHaveCount(1);
});
