import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { resolveNarrationV2 } from "@praxity/shared-blocks/narration";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { silentWav } from "../fixtures/silent-audio";

const task = "Explain the delay.";
const model = "MODEL_SECRET The data arrived late.";
let server: Server;
let url: string;
const files = new Map<string, Buffer>();

test.beforeAll(async () => {
	test.setTimeout(120_000);
	// This checks Follow while playing, so the clip must outlast inspection of the inadmissible cue.
	const audio = silentWav(10);
	let next = 0;
	const read = readLesson(
		`# Practice\n::: accordion\n:: Practice task\n::: self-check ${task}\nmodel: ${model}\n:: LABEL_SECRET\nmissed: HINT_SECRET Add a reason.\nevidence: The data arrived late.\n:::\n:::\n`,
		{ ids: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}` },
	);
	const check = [...read.nodes.values()].find(
		(record) => !record.role && record.node.type === "self-check",
	);
	if (!check) throw new Error("Missing self-check fixture");
	const courseId = "00000000-0000-4000-8000-000000000101";
	const lessonId = "00000000-0000-4000-8000-000000000102";
	const narration = resolveNarrationV2({
		courseId,
		lessonId,
		pages: read.pages,
		locale: "en",
		digest: (text) => text,
		sidecar: {
			version: 2,
			courseId,
			lessons: {
				[lessonId]: {
					enabled: true,
					segments: [
						{
							target: { id: check.id, role: "title" },
							reviewedRevision: task,
							audio: "https://self-check-narration.example/task.wav",
							timings: "https://self-check-narration.example/task.vtt",
							audioFor: { script: task, language: "en", voice: "Maya", speed: 1 },
						},
					],
				},
			},
		},
	});
	expect(narration.unresolved).toEqual([]);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://self-check-narration.example/")
			? Promise.resolve(
					new Response(
						String(input).endsWith(".vtt")
							? `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${task}\n\n00:00:01.000 --> 00:00:03.000\n${model}\n`
							: new Uint8Array(audio),
					),
				)
			: originalFetch(input, options);
	try {
		// Publication remains refused. This direct compiler fixture exercises the prepared runtime.
		const artifact = await compileCourse({
			id: courseId,
			title: "Practice",
			sourceLocale: "en",
			content: read.pages.map((page, index) => ({
				...page,
				narrationEnabled: true,
				data: { ...page.data, _narrationSegments: narration.pages[index].segments },
			})),
			selfCheckContents: [selfCheckContentInput(check.id, readSelfCheckContent(read, check.id))],
		});
		try {
			const deployment = await deployCourse(artifact, { format: "html" });
			for (const entry of new AdmZip(deployment.zip).getEntries())
				if (!entry.isDirectory) files.set(`/${entry.entryName}`, entry.getData());
			url = `/${artifact.manifest.pages[0].slug}.html`;
		} finally {
			await artifact.dispose();
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		if (!bytes) {
			response.writeHead(404);
			response.end();
			return;
		}
		const types: Record<string, string> = {
			html: "text/html; charset=utf-8",
			js: "text/javascript",
			css: "text/css",
			wav: "audio/wav",
			vtt: "text/vtt",
			woff2: "font/woff2",
		};
		response.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as { port: number }).port}${url}`;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

test("task Follow opens the disclosure without revealing or reading a comparison", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url() + (request.postData() ?? "")));
	await page.goto(url);
	const toggle = page.getByRole("button", { name: "Practice task", exact: true });
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	const activity = page.locator("[data-self-check]");
	const transport = page.locator(".praxity-narration-transport");
	await page.getByRole("button", { name: "Listen", exact: true }).click();
	const audio = page.locator("audio[data-narration-player]");
	await expect
		.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).readyState))
		.toBeGreaterThan(0);
	await transport.getByRole("button", { name: "Play", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await expect(activity.locator(".praxity-assessment-stem")).toBeInViewport();
	await expect(transport.getByRole("button", { name: "Pause", exact: true })).toBeFocused();
	await expect(activity.getByRole("checkbox")).toHaveCount(0);
	await expect(activity.locator("[data-self-check-comparison]")).toBeEmpty();
	await expect(activity).not.toContainText("MODEL_SECRET");
	await expect(activity).not.toContainText("HINT_SECRET");
	await transport.getByRole("button", { name: "Pause", exact: true }).click();
	await activity.locator("textarea").fill("PRIVATE_ANSWER");
	await activity.locator('[data-self-check-action="check"]').focus();
	await page.keyboard.press("Enter");
	await expect(activity.getByRole("checkbox")).toBeFocused();
	await expect(activity).not.toContainText("MODEL_SECRET");
	await expect(activity.locator("[data-self-check-comparison]")).toBeEmpty();
	await activity.locator('[data-self-check-action="show-feedback"]').focus();
	await page.keyboard.press("Enter");
	await expect(activity).toContainText(model);
	await expect(activity).toContainText("HINT_SECRET");
	await expect(transport.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	// A stale timing file must not let Follow search feedback or the learner's answer.
	await audio.evaluate((node) => {
		(node as HTMLAudioElement).currentTime = 1.2;
	});
	await transport.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
				return [...(registry?.get("praxity-narration-current") ?? [])].map((range) =>
					range.toString(),
				);
			}),
		)
		.toEqual([]);
	await expect(activity.locator(".praxity-assessment-stem")).toHaveAttribute(
		"data-narration-active",
		"true",
	);
	const config = await page.locator("#praxity-config").textContent();
	expect(config).not.toContain("PRIVATE_ANSWER");
	expect(config).not.toContain("MODEL_SECRET");
	expect(config).not.toContain("HINT_SECRET");
	expect(requests.join("\n")).not.toContain("PRIVATE_ANSWER");
});
