import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notes host</title></head><body>
<header><button type="button" id="notes-button" popovertarget="notes">Notes <span data-notes-badge hidden></span></button>
<button type="button" id="menu-button" popovertarget="menu">Menu</button></header>
<aside id="notes" popover="manual"><h2>Review notes</h2><a href="#first">First note</a></aside>
<nav id="menu" popover="manual"><a href="#home">Home</a></nav>
<script type="module">
import { mountNotesPanel } from "/review-notes-panel.js";
window.notes = mountNotesPanel(document.querySelector("#notes-button"), { sibling: document.querySelector("#menu") });
</script></body></html>`;

test("notes panel closes on Escape, returns focus, closes its sibling and fills the badge", async ({
	page: tab,
}) => {
	const module = await readFile(
		resolve(
			import.meta.dirname,
			"../../../../packages/export-pipeline/template/review-notes-panel.js",
		),
		"utf8",
	);
	await tab.route("http://notes.test/**", (route) =>
		route.fulfill(
			new URL(route.request().url()).pathname === "/review-notes-panel.js"
				? { contentType: "text/javascript", body: module }
				: { contentType: "text/html", body: page },
		),
	);
	await tab.goto("http://notes.test/");
	await tab.waitForFunction(() => "notes" in window);
	const isOpen = (selector: string) =>
		tab.evaluate(
			(selector) => document.querySelector(selector)?.matches(":popover-open"),
			selector,
		);
	const button = tab.getByRole("button", { name: "Notes", exact: true });
	const badge = tab.locator("[data-notes-badge]");

	await tab.evaluate(() =>
		(window as unknown as { notes: { setCount(n: number): void } }).notes.setCount(3),
	);
	await expect(badge).toHaveText("3");
	await expect(badge).toBeVisible();
	await expect(tab.getByRole("button", { name: "Notes 3", exact: true })).toHaveCount(1);
	await tab.evaluate(() =>
		(window as unknown as { notes: { setCount(n: number): void } }).notes.setCount(0),
	);
	await expect(badge).toBeHidden();

	await button.focus();
	await tab.keyboard.press("Enter");
	expect(await isOpen("#notes")).toBe(true);
	await tab.getByRole("link", { name: "First note" }).focus();
	await tab.keyboard.press("Escape");
	expect(await isOpen("#notes")).toBe(false);
	await expect(button).toBeFocused();

	await tab.keyboard.press("Enter");
	expect(await isOpen("#notes")).toBe(true);
	await tab.keyboard.press("Escape");
	expect(await isOpen("#notes")).toBe(false);

	await tab.getByRole("button", { name: "Menu", exact: true }).click();
	expect(await isOpen("#menu")).toBe(true);
	await button.click();
	expect(await isOpen("#notes")).toBe(true);
	expect(await isOpen("#menu")).toBe(false);
	await tab.getByRole("button", { name: "Menu", exact: true }).click();
	expect(await isOpen("#menu")).toBe(true);
	expect(await isOpen("#notes")).toBe(false);
});
