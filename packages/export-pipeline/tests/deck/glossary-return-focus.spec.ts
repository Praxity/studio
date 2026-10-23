import { expect, test } from "../fixtures/published-navigation";

for (const mode of ["deck", "pages"]) {
	for (const source of ["definition", "outline"]) {
		test(`${mode} ${source} glossary tab returns focus to its trigger`, async ({
			page,
			publishedNavigation,
		}, testInfo) => {
			await page.goto(`${publishedNavigation}/${mode}-en/index.html`);
			if (mode === "deck")
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			const term = page.locator(".inline-tooltip-trigger").first();
			if (source === "definition") {
				await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
				await term.focus();
				await page.keyboard.press("Enter");
			}
			const link = page.locator(
				source === "definition"
					? ".inline-tooltip-popover .praxity-glossary-link"
					: 'a[target="_blank"][href="glossary.html"]:not(.praxity-glossary-link)',
			);
			if (source === "outline" && mode === "deck" && !(await link.isVisible())) {
				await page.locator("#deck-more-toggle").click();
				await page.locator("#deck-outline-toggle").click();
			}
			await expect(link).toBeVisible();
			await link.focus();
			await page.evaluate(() => {
				const events: unknown[] = [];
				(window as Window & { glossaryReturnEvents?: unknown[] }).glossaryReturnEvents = events;
				const record = (event: Event) => {
					const sample = (phase: string) =>
						events.push({
							event: event.type,
							phase,
							target: (event.target as Element)?.tagName ?? "window",
							active: document.activeElement?.tagName,
							visibility: document.visibilityState,
							focused: document.hasFocus(),
						});
					sample("event");
					queueMicrotask(() => sample("microtask"));
					requestAnimationFrame(() => setTimeout(() => sample("settled"), 0));
				};
				window.addEventListener("focus", record);
				window.addEventListener("pageshow", record);
				document.addEventListener("visibilitychange", record);
				document.addEventListener("focusin", record);
			});
			const popup = page.waitForEvent("popup");
			await page.keyboard.press("Enter");
			const glossary = await popup;
			await expect(glossary).toHaveURL(/glossary\.html$/);
			await glossary.close();
			await page.bringToFront();
			if (source === "definition" && !(await link.isVisible())) await expect(term).toBeFocused();
			else await expect(link).toBeFocused();
			await page.evaluate(
				() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))),
			);
			await testInfo.attach("glossary-return-events", {
				body: JSON.stringify(
					await page.evaluate(
						() => (window as Window & { glossaryReturnEvents?: unknown[] }).glossaryReturnEvents,
					),
				),
				contentType: "application/json",
			});
		});
	}
}

for (const state of ["open", "closed", "other-focus", "hidden-document"]) {
	test(`glossary return survives a late BODY reset with ${state} popover`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/deck-en/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const term = page.locator(".inline-tooltip-trigger").first();
		await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
		await term.focus();
		await page.keyboard.press("Enter");
		const link = page.locator(".inline-tooltip-popover .praxity-glossary-link");
		await expect(link).toBeVisible();
		await link.focus();
		await expect(link).toBeFocused();
		await link.evaluate((element) =>
			element.addEventListener("click", (event) => event.preventDefault(), { once: true }),
		);
		await page.keyboard.press("Enter");
		if (state === "closed") await page.keyboard.press("Escape");
		await page.evaluate(async (state) => {
			// Keep the popover open while modelling the browser's native focus reset.
			document.addEventListener("focusout", (event) => event.stopPropagation(), { capture: true });
			(document.activeElement as HTMLElement)?.blur();
			document.dispatchEvent(new Event("visibilitychange"));
			window.dispatchEvent(new Event("focus"));
			// Firefox restores the native target after window focus, before its late reset.
			document
				.querySelector<HTMLElement>(
					state === "closed"
						? ".inline-tooltip-trigger"
						: ".inline-tooltip-popover .praxity-glossary-link",
				)
				?.focus();
			window.dispatchEvent(new Event("pageshow"));
			await new Promise<void>((done) =>
				requestAnimationFrame(() => {
					(document.activeElement as HTMLElement)?.blur();
					if (state === "other-focus") document.querySelector<HTMLElement>("#deck-next")?.focus();
					if (state === "hidden-document")
						Object.defineProperty(document, "visibilityState", {
							configurable: true,
							value: "hidden",
						});
					setTimeout(done, 0);
				}),
			);
		}, state);
		if (state === "open") await expect(link).toBeFocused();
		else if (state === "closed") await expect(term).toBeFocused();
		else if (state === "other-focus") await expect(page.locator("#deck-next")).toBeFocused();
		else {
			await expect(page.locator("body")).toBeFocused();
			await page.evaluate(() => {
				Reflect.deleteProperty(document, "visibilityState");
				document.dispatchEvent(new Event("visibilitychange"));
			});
			await expect(link).toBeFocused();
		}
	});
}

for (const state of ["open", "closed", "hidden", "removed", "other-focus", "hidden-document"]) {
	test(`glossary BODY recovery with ${state} trigger consumes one return request`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/deck-en/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const term = page.locator(".inline-tooltip-trigger").first();
		await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
		await term.focus();
		await page.keyboard.press("Enter");
		const link = page.locator(".inline-tooltip-popover .praxity-glossary-link");
		await expect(link).toBeVisible();
		await link.focus();
		// Capture activation without requiring the headless window manager to lose focus.
		await link.evaluate((element) => {
			element.addEventListener("click", (event) => event.preventDefault(), { once: true });
		});
		await page.keyboard.press("Enter");
		if (state === "closed") await page.keyboard.press("Escape");
		await page.evaluate((state) => {
			if (["open", "hidden", "other-focus", "hidden-document"].includes(state))
				document.activeElement?.addEventListener("focusout", (event) => event.stopPropagation(), {
					once: true,
				});
			if (state === "hidden") {
				const popover = document.querySelector<HTMLElement>(".inline-tooltip-popover");
				if (popover) popover.style.visibility = "hidden";
			}
			if (state === "removed") {
				(document.activeElement as HTMLElement)?.blur();
				document.querySelector(".inline-tooltip-trigger")?.remove();
				document.querySelector(".inline-tooltip-popover")?.remove();
			}
			(document.activeElement as HTMLElement)?.blur();
		}, state);
		await expect(page.locator("body")).toBeFocused();
		if (state === "other-focus") await page.locator("#deck-next").focus();
		if (state === "hidden-document") {
			await page.evaluate(() => {
				Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
				window.dispatchEvent(new Event("focus"));
				document.dispatchEvent(new Event("visibilitychange"));
			});
			await expect(page.locator("body")).toBeFocused();
			await page.evaluate(() => Reflect.deleteProperty(document, "visibilityState"));
		}
		await page.evaluate(() => {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		});
		if (state === "open" || state === "hidden-document") await expect(link).toBeFocused();
		else if (state === "closed" || state === "hidden") await expect(term).toBeFocused();
		else if (state === "other-focus") await expect(page.locator("#deck-next")).toBeFocused();
		else await expect(page.locator("body")).toBeFocused();
		await page.evaluate(
			() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))),
		);
		await page.evaluate(() => {
			(document.activeElement as HTMLElement)?.blur();
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await expect(page.locator("body")).toBeFocused();
	});
}

test("the newest glossary activation owns focus across shell and tooltip bundles", async ({
	page,
	publishedNavigation,
}) => {
	await page.goto(`${publishedNavigation}/deck-en/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const term = page.locator(".inline-tooltip-trigger").first();
	await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
	await term.click();
	const definition = page.locator(".inline-tooltip-popover .praxity-glossary-link");
	await definition.evaluate((link) =>
		link.addEventListener("click", (event) => event.preventDefault()),
	);
	await definition.click();
	await page.locator("#deck-more-toggle").click();
	await page.locator("#deck-outline-toggle").click();
	const outline = page.locator(".deck-glossary-link");
	await outline.evaluate((link) =>
		link.addEventListener("click", (event) => event.preventDefault()),
	);
	await outline.click();
	await page.evaluate(() => {
		(document.activeElement as HTMLElement)?.blur();
		window.dispatchEvent(new Event("focus"));
	});
	await expect(outline).toBeFocused();
});
