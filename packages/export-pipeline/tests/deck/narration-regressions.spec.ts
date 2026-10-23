import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { resolveNarrationV2 } from "@praxity/shared-blocks/narration";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { moduleDeckFixture } from "../fixtures/module-deck";

let server: Server;
let url: string;
let transcriptUrl: string;
let frenchUrl: string;
const files = new Map<string, Buffer>();
const audioGates = new Map<string, { ready: Promise<void>; unavailable: boolean }>();
let nextAudioGate = 0;

function holdAudio(unavailable: boolean, locale: "en" | "fr" = "en") {
	let release: () => void = () => undefined;
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	const prefix = `/media-${++nextAudioGate}`;
	audioGates.set(prefix, { ready, unavailable });
	const gatedURL = new URL(locale === "fr" ? frenchUrl : url);
	gatedURL.pathname = prefix + gatedURL.pathname;
	return {
		url: gatedURL.href,
		release,
		dispose() {
			release();
			audioGates.delete(prefix);
		},
	};
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	const audio = await readFile(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://narration-regression.example/")
			? Promise.resolve(new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }))
			: originalFetch(input, options);
	try {
		const course = moduleDeckFixture("https://narration-regression.example/fixture.mp3");
		course.content = course.content.slice(0, 2);
		course.moduleDeck = { gates: { "practice-gate": "attempt" } };
		const intro = course.content[0].blocks.find((block) => block.type === "text");
		if (!intro) throw new Error("Missing introduction text fixture");
		intro.data.content =
			'<p><span class="inline-tooltip-trigger" data-tooltip-content="A system">magnification</span>, <mark>focus</mark>, and alignment.</p>';
		delete intro.data.narration;
		for (const page of course.content) {
			page.data = { ...page.data, narrationDuration: 0.25 };
			for (const block of page.blocks)
				if (block.data.narrationAudio) block.data.narrationDuration = 0.25;
		}
		const artifact = await compileCourse(course, { mode: "source" });
		try {
			const deployment = await deployCourse(artifact, { format: "html" });
			if (!("zip" in deployment)) throw new Error("Expected HTML package");
			for (const file of new AdmZip(deployment.zip).getEntries())
				if (!file.isDirectory) files.set(`/${file.entryName}`, file.getData());
			url = `/${artifact.manifest.pages[0].slug}.html`;
		} finally {
			await artifact.dispose();
		}
		const frenchArtifact = await compileCourse(
			{ ...course, id: "narration-regression-fr", sourceLocale: "fr" },
			{ mode: "source" },
		);
		try {
			const deployment = await deployCourse(frenchArtifact, { format: "html" });
			if (!("zip" in deployment)) throw new Error("Expected French HTML package");
			for (const file of new AdmZip(deployment.zip).getEntries())
				if (!file.isDirectory) files.set(`/fr/${file.entryName}`, file.getData());
			frenchUrl = `/fr/${frenchArtifact.manifest.pages[0].slug}.html`;
		} finally {
			await frenchArtifact.dispose();
		}
		let sequence = 0;
		const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
		const courseId = id(),
			lessonId = id();
		const read = readLesson(
			"# Deux façons d'exprimer un besoin\n\nRoger veut exprimer un besoin.\n\n::: free-response Réflexion : comment se sont passées vos tentatives ?\nDans quelles situations avez-vous utilisé ces techniques ?\n:::\n",
			{ ids: id },
		);
		expect(read.hasErrors).toBe(false);
		const resolved = resolveNarrationV2({
			courseId,
			lessonId,
			pages: read.pages,
			sidecar: { version: 2, courseId, lessons: { [lessonId]: { enabled: true, segments: [] } } },
			locale: "fr",
			digest: (text) => text,
		});
		const transcript = moduleDeckFixture(undefined, "fr");
		transcript.content = read.pages.map((page, index) => ({
			...page,
			lessonId,
			narrationEnabled: true,
			data: {
				...page.data,
				_narrationSegments: resolved.pages[index].segments.map((segment) => ({
					...segment,
					audioUrl: "https://narration-regression.example/fixture.mp3",
				})),
			},
		}));
		transcript.moduleDeck = {};
		const transcriptArtifact = await compileCourse(transcript, { mode: "source" });
		try {
			const deployment = await deployCourse(transcriptArtifact, { format: "html" });
			if (!("zip" in deployment)) throw new Error("Expected HTML package");
			for (const file of new AdmZip(deployment.zip).getEntries())
				if (!file.isDirectory) files.set(`/transcript/${file.entryName}`, file.getData());
			transcriptUrl = `/transcript/${transcriptArtifact.manifest.pages[0].slug}.html`;
		} finally {
			await transcriptArtifact.dispose();
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer(async (req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const gatedPath = /^(\/media-\d+)(\/.*)$/.exec(path);
		const gate = gatedPath ? audioGates.get(gatedPath[1]) : undefined;
		const fixturePath = gatedPath ? gatedPath[2] : path;
		const bytes = files.get(fixturePath);
		if (!bytes || (gatedPath && !gate)) {
			res.writeHead(404);
			res.end();
			return;
		}
		if (gate && fixturePath.endsWith(".mp3")) {
			// WebKit's media loader can bypass browser routing. Hold and fail the
			// actual HTTP response so metadata and playback observe the same outcome.
			await gate.ready;
			if (gate.unavailable) {
				res.writeHead(503);
				res.end();
				return;
			}
		}
		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			mp3: "audio/mpeg",
			json: "application/json",
			woff2: "font/woff2",
		};
		res.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(req, res, bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as { port: number }).port}${url}`;
	frenchUrl = new URL(frenchUrl, url).href;
	transcriptUrl = new URL(transcriptUrl, url).href;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

test("grammar 4 published transcript matches the baseline title and paragraph policy", async ({
	page,
}) => {
	await page.goto(transcriptUrl);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-more-toggle").click();
	await page.locator("#deck-script-toggle").click();
	const transcript = page.locator("#deck-script-scroll");
	await expect(transcript).toBeVisible();
	await expect(transcript).not.toContainText("Deux façons d'exprimer un besoin");
	await expect(transcript.locator(".deck-script-seek")).toHaveCount(2);
	await expect(transcript.locator(".deck-script-content").last().locator("p")).toHaveText([
		"Réflexion : comment se sont passées vos tentatives ?",
		"Dans quelles situations avez-vous utilisé ces techniques ?",
	]);
	await expect(transcript.locator(".deck-script-content").last().locator("strong")).toHaveText(
		"Réflexion : comment se sont passées vos tentatives ?",
	);
});

test("reading text keeps inline punctuation and choice boundaries while the timeline verifies audio", async ({
	page,
}) => {
	const audio = holdAudio(false);
	try {
		await page.goto(audio.url, { waitUntil: "domcontentloaded" });
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		const slider = page.getByRole("slider", { name: "Position in narration" });
		const time = page.locator(".praxity-narration-time");
		await expect(slider).toBeDisabled();
		await expect(time).toHaveCount(0);
		await expect(slider).toHaveAttribute("aria-valuetext", getStrings("en").durationLoading);
		audio.release();
		await expect(slider).toBeEnabled({ timeout: 20_000 });
		const total = await slider.getAttribute("max");
		expect(Number(total)).toBeGreaterThan(4);
		await expect(time).toContainText(" / ");

		await page.locator("#deck-more-toggle").click();
		await page.locator("#deck-script-toggle").click();
		const introduction = page.locator('[data-deck-reading="slide-1"]');
		await expect(introduction).toContainText("magnification, focus, and alignment.");
		await expect(introduction).not.toContainText("magnification ,");
		await page.locator("#deck-next").click();
		await expect(
			page.locator('[data-deck-reading="slide-2"] .deck-script-content ul > li'),
		).toHaveText(["Ask what support is needed", "Make an assumption", "I don't know"]);
		await expect(slider).toHaveAttribute("max", total ?? "");
		await page.locator("#deck-previous").click();
		await page.locator(".praxity-narration-transport button").click();
		await expect(slider).toHaveAttribute("max", total ?? "");
	} finally {
		audio.dispose();
	}
});

test("narrow narration keeps one seekable timeline through Tools and resizing", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const audio = holdAudio(false);
	try {
		await page.goto(audio.url, { waitUntil: "domcontentloaded" });
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await page.getByRole("button", { name: "Tools", exact: true }).click();
		const slider = page.getByRole("slider", { name: getStrings("en").seek });
		await expect(slider).toBeVisible();
		await expect(slider).toBeDisabled();
		audio.release();
		await expect(slider).toBeEnabled({ timeout: 20_000 });
		await expect
			.poll(() =>
				page
					.locator("audio[data-narration-player]")
					.evaluate((element) => (element as HTMLAudioElement).readyState),
			)
			.toBeGreaterThanOrEqual(1);
		await slider.focus();
		await slider.press("PageUp");
		const player = page.locator("audio[data-narration-player]");
		await expect
			.poll(() => player.evaluate((element) => (element as HTMLAudioElement).currentTime))
			.toBeGreaterThan(0);
		await expect(player).toHaveJSProperty("seeking", false);
		await expect.poll(() => slider.inputValue()).not.toBe("0");
		const position = await slider.inputValue();
		const duration = await slider.getAttribute("max");
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(page.locator("#deck-narration input[type=range]")).toBeVisible();
		await expect(slider).toHaveValue(position);
		await expect(slider).toHaveAttribute("max", duration ?? "");
		await expect(page.locator("input[type=range]")).toHaveCount(1);
		await page.setViewportSize({ width: 768, height: 1024 });
		await expect(page.locator("#deck-more-playback input[type=range]")).toBeVisible();
		await expect(slider).toHaveValue(position);
		await expect(page.locator("input[type=range]")).toHaveCount(1);
	} finally {
		audio.dispose();
	}
});

for (const locale of ["en", "fr"] as const) {
	test(`mobile unknown duration stays out of Tools with accessible labels in ${locale}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 640 });
		const audio = holdAudio(true, locale);
		try {
			await page.goto(audio.url, { waitUntil: "domcontentloaded" });
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await page.locator("#deck-more-toggle").click();
			const time = page.locator(".praxity-narration-time");
			const slider = page.getByRole("slider", { name: getStrings(locale).seek });
			await expect(time).toHaveCount(0);
			await expect(slider).toBeDisabled();
			await expect(slider).toHaveAttribute("aria-valuetext", getStrings(locale).durationLoading);
			audio.release();
			await expect(slider).toHaveAttribute(
				"aria-valuetext",
				getStrings(locale).durationUnavailable,
			);
			await expect(time).toHaveCount(0);
			await expect(slider).toBeDisabled();
			const bounds = await page.locator("#deck-more-panel").evaluate((menu) => ({
				left: menu.getBoundingClientRect().left,
				right: menu.getBoundingClientRect().right,
				overflow: menu.scrollWidth > menu.clientWidth + 1,
			}));
			expect(bounds.left).toBeGreaterThanOrEqual(0);
			expect(bounds.right).toBeLessThanOrEqual(320);
			expect(bounds.overflow).toBe(false);
		} finally {
			audio.dispose();
		}
	});
}
