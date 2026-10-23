import type { Page, TestInfo } from "@playwright/test";

const requestsByPage = new WeakMap<Page, { url: string; event: string }[]>();
const documentsByPage = new WeakMap<Page, unknown[]>();
const needsEvidence = (title: string) =>
	title.startsWith("typing while restore support loads") ||
	title === "edits survive support failure with a draft";

/** Synthetic fixture evidence only; never enabled in published runtime. */
export async function instrumentSelfCheckEdit(page: Page, info: TestInfo) {
	if (!needsEvidence(info.title)) return;
	const documents: unknown[] = [];
	documentsByPage.set(page, documents);
	page.on("console", (message) => {
		if (message.text().startsWith("SELF_CHECK_TEST "))
			documents.push(JSON.parse(message.text().slice("SELF_CHECK_TEST ".length)));
	});
	const requests: { url: string; event: string }[] = [];
	requestsByPage.set(page, requests);
	page.on("request", (request) => {
		if (/self-check/.test(request.url())) requests.push({ url: request.url(), event: "request" });
	});
	page.on("requestfinished", (request) => {
		if (/self-check/.test(request.url())) requests.push({ url: request.url(), event: "finished" });
	});
	await page.addInitScript(() => {
		const events: unknown[] = [];
		Reflect.set(window, "selfCheckEditEvidence", events);
		const record = (event: string) => {
			const root = document.querySelector<HTMLElement>("[data-self-check]");
			if (!root) return;
			const saved = window.__praxityBlockState?.get(root.dataset.selfCheckId ?? "");
			const entry = {
				event,
				document: performance.timeOrigin,
				time: performance.now(),
				answer: root.querySelector("textarea")?.value,
				marker: root.getAttribute("data-self-check-edited"),
				saved,
				title: root.querySelector("[data-self-check-comparison-title]")?.textContent,
				mounted: !!root.querySelector("[data-self-check-report]"),
				focused: document.activeElement?.id,
			};
			events.push(entry);
			console.debug(`SELF_CHECK_TEST ${JSON.stringify(entry)}`);
		};
		document.addEventListener("input", () => record("input"), true);
		document.addEventListener("input", () => record("input-after"));
		let provider: Window["__praxityBlockState"];
		Object.defineProperty(window, "__praxityBlockState", {
			configurable: true,
			get: () => provider,
			set(value: Window["__praxityBlockState"]) {
				provider = value;
				if (!value) return;
				const write = value.set;
				value.set = (...args: Parameters<typeof write>) => {
					const result = write(...args);
					record("state-write");
					return result;
				};
			},
		});
		let support: unknown;
		Object.defineProperty(window, "__praxitySelfCheckSupport", {
			configurable: true,
			get: () => support,
			set(value) {
				support = value;
				const enhance = value.enhance;
				value.enhance = (...args: Parameters<typeof enhance>) => {
					record("before-mount");
					const result = enhance(...args);
					record("after-mount");
					return result;
				};
				if (value.admit) {
					const admit = value.admit;
					value.admit = async (...args: Parameters<typeof admit>) => {
						record("admission-request");
						const result = await admit(...args);
						record("admission-resolved");
						return result;
					};
				}
			},
		});
		document.addEventListener("praxity:self-check-completion", () => record("completion"));
		document.addEventListener("DOMContentLoaded", () => {
			record("document-ready");
			new MutationObserver(() => record("mutation")).observe(document.body, {
				childList: true,
				subtree: true,
			});
		});
	});
	// The caller attaches the terminal DOM/state even when the literal title fails.
}

export async function attachSelfCheckEdit(page: Page, info: TestInfo) {
	if (!needsEvidence(info.title)) return;
	await info.attach("document-sequence", {
		contentType: "application/json",
		body: JSON.stringify(documentsByPage.get(page)),
	});
	await info.attach("support-requests", {
		contentType: "application/json",
		body: JSON.stringify(requestsByPage.get(page)),
	});
	await info.attach("edit-sequence", {
		contentType: "application/json",
		body: JSON.stringify(
			await page.evaluate(() => ({
				events: Reflect.get(window, "selfCheckEditEvidence"),
				answer: document.querySelector("textarea")?.value,
				saved: window.__praxityBlockState?.get(
					document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
				),
				title: document.querySelector("[data-self-check-comparison-title]")?.textContent,
			})),
		),
	});
}
