import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";

let folder: string, base: string, server: Server;
const entries: Record<string, string> = {};
const questionId = "10000000-0000-4000-8000-000000000001";

test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "scorm12-submission-"));
	for (const locale of ["en", "fr"] as const) {
		const lesson = readLesson(
			"# Practice\n::: choice Choose safely {scored points=10 attempts=1}\n(x) Stop\n( ) Continue\n:::\n",
		);
		if (lesson.hasErrors) throw new Error(JSON.stringify(lesson.errors));
		const question = lesson.pages
			.flatMap((page) => page.blocks)
			.find((block) => block.type === "assessment");
		if (!question) throw new Error("Missing choice fixture");
		question.id = questionId;
		lesson.pages[0].blocks.push({
			id: "10000000-0000-4000-8000-000000000002",
			type: "assessment",
			data: {
				assessmentType: "textResponse",
				gradingMode: "none",
				attempts: 1,
				feedback: {},
				stem: [{ id: "open-stem", type: "text", data: { content: "Describe the hazard" } }],
				response: { type: "textResponse", inputType: "short" },
			},
		});
		const artifact = await compileCourse({
			id: `submission-${locale}`,
			title: "Practice",
			sourceLocale: locale,
			content: lesson.pages,
		});
		try {
			entries[locale] = `${locale}/${artifact.manifest.pages[0].slug}.html`;
			new AdmZip((await deployCourse(artifact, { format: "scorm12" })).zip).extractAllTo(
				join(folder, locale),
				true,
			);
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			if (path.includes("..")) throw new Error("Invalid fixture path");
			const bytes = await readFile(join(folder, path));
			response.writeHead(200, {
				"Content-Type": path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".css")
						? "text/css"
						: "text/html; charset=utf-8",
			});
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	if (folder) await rm(folder, { recursive: true, force: true });
});

async function installLms(page: Page, initial: Record<string, string> = {}) {
	await page.addInitScript((initial) => {
		const values: Record<string, string> = JSON.parse(
			localStorage.getItem("test-lms") ?? JSON.stringify(initial),
		);
		localStorage.setItem("test-lms", JSON.stringify(values));
		Object.assign(window, {
			API: {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
				LMSGetErrorString: () => "",
				LMSGetDiagnostic: () => "",
				LMSGetValue: (key: string) => values[key] ?? "",
				LMSSetValue: (key: string, value: string) => {
					if (key === "cmi.suspend_data") {
						if (value.length > 4096) throw new Error("Suspend data exceeded the real cap");
						if (sessionStorage.getItem("refuse") === "yes") return "false";
					}
					values[key] = value;
					localStorage.setItem("test-lms", JSON.stringify(values));
					return "true";
				},
			},
		});
	}, initial);
}

for (const locale of ["en", "fr"] as const) {
	test(`refused LMS write retains the draft and allows keyboard retry in ${locale}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installLms(page);
		await page.goto(base + entries[locale]);
		const activity = page.locator('[data-island="assessment"]').first();
		await expect(activity).toHaveAttribute("data-hydrated", "");
		const first = activity.getByRole("radio", { name: /Stop/ });
		await first.focus();
		await page.keyboard.press("Space");
		await expect(first).toBeChecked();
		await expect
			.poll(() =>
				page.evaluate((id) => {
					const state = window.__praxityBlockState?.get(id);
					return (
						state !== null &&
						typeof state === "object" &&
						!Array.isArray(state) &&
						state.interacted === true
					);
				}, questionId),
			)
			.toBe(true);
		const before = await page.evaluate(
			() => JSON.parse(localStorage.getItem("test-lms") ?? "{}")["cmi.suspend_data"],
		);
		expect(before).toBeTruthy();
		await page.evaluate(() => sessionStorage.setItem("refuse", "yes"));
		const submit = activity.getByRole("button", {
			name: locale === "en" ? "Submit" : "Soumettre",
			exact: true,
		});
		await submit.press("Enter");
		await expect(activity.getByRole("status")).toHaveText(
			locale === "en"
				? "This answer could not be saved. Your previously saved progress is kept."
				: "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée.",
		);
		await expect(first).toBeEnabled();
		await expect(first).toBeChecked();
		await expect(submit).toBeFocused();
		expect(
			await page.evaluate(
				() => JSON.parse(localStorage.getItem("test-lms") ?? "{}")["cmi.suspend_data"],
			),
		).toBe(before);
		await page.reload();
		await expect(activity).toHaveAttribute("data-hydrated", "");
		await expect(first).toBeEnabled();
		await expect(first).toBeChecked();
		await page.evaluate(() => sessionStorage.removeItem("refuse"));
		await submit.press("Enter");
		await expect(first).toBeDisabled();
		await expect(submit).toHaveCount(0);
		await expect(activity.getByRole("status")).toHaveCount(0);
		await page.reload();
		await expect(activity).toHaveAttribute("data-hydrated", "");
		await expect(first).toBeChecked();
		await expect(first).toBeDisabled();
		const state = await page.evaluate(
			(id) => ({
				answer: window.__praxityBlockState?.get(id),
				rows: (window.__praxityRuntime as SCORMRuntime | undefined)?.getInteractions(),
			}),
			questionId,
		);
		expect(state.answer).toMatchObject({
			checked: true,
			completed: true,
			correct: true,
			attemptCount: 1,
		});
		expect(state.rows).toMatchObject([{ id: questionId, correct: true, score: 100 }]);
		expect(errors).toEqual([]);
	});

	test(`unreadable storage keeps an open draft editable through reload in ${locale}`, async ({
		page,
	}) => {
		const original =
			'{"visitedPages":["page-a"],"interactions":[{"id":"q","response":"Stop","correct":true,"score":100,"timestamp":1800000000000}],"custom":{}}';
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installLms(page, {
			"cmi.suspend_data": original,
			"cmi.core.student_id": "learner",
			"cmi.core.lesson_status": "passed",
			"cmi.core.score.raw": "100",
		});
		await page.goto(base + entries[locale]);
		const activity = page.locator('[data-island="assessment"]').nth(1);
		await expect(activity).toHaveAttribute("data-hydrated", "");
		const answer = activity.getByRole("textbox");
		await expect(activity.getByRole("status")).toBeVisible();
		await answer.fill("Wet floor by the door");
		await activity
			.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre", exact: true })
			.press("Enter");
		await expect(answer).toBeEditable();
		await expect(answer).toHaveValue("Wet floor by the door");
		await expect(activity).not.toHaveAttribute("data-completed", "true");
		await expect(activity.getByRole("status")).toBeVisible();
		await page.reload();
		await expect(activity).toHaveAttribute("data-hydrated", "");
		await expect(answer).toHaveValue("Wet floor by the door");
		await expect(answer).toBeEditable();
		await expect(
			activity.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre", exact: true }),
		).toBeEnabled();
		await expect(activity.getByRole("status")).toBeVisible();
		await expect(activity).not.toHaveAttribute("data-completed", "true");
		const values = await page.evaluate(() => JSON.parse(localStorage.getItem("test-lms") ?? "{}"));
		expect(values["cmi.suspend_data"]).toBe(original);
		expect(values["cmi.core.lesson_status"]).toBe("passed");
		expect(values["cmi.core.score.raw"]).toBe("100");
		expect(values["cmi.interactions.0.id"]).toBeUndefined();
		expect(errors).toEqual([]);
	});
}
