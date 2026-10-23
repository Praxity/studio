import { expect, it } from "vitest";
import {
	type CanvasTextBinding,
	type CanvasTextGeometry,
	type CanvasTextReply,
	type CanvasTextRequest,
	canvasTextNeedsFallback,
	createCanvasTextSession,
} from "./canvas-text";

const original = "# Page\n\n## Before\n\nOther.\n";
const binding: CanvasTextBinding = {
	file: "lesson.prax",
	nodeId: "heading",
	kind: "heading",
	field: "subject",
	text: "Before",
	baseRevision: "a".repeat(64),
};

it.each([
	["heading", "subject", " Name ", "Name", "closed"],
	["page", "subject", "\tName\t", "Name", "closed"],
	["body", "text", " Name ", "Name", "editing"],
] as const)(
	"break-ui B lost reply uses saved whitespace for %s",
	async (kind, field, input, savedText, phase) => {
		const saved = { ...binding, kind, field, text: savedText, baseRevision: "b".repeat(64) };
		const session = createCanvasTextSession(
			{
				async apply() {
					throw new Error("Lost reply");
				},
				async snapshot() {
					return { fields: [saved] };
				},
			},
			() => {},
		);
		session.open({ ...binding, kind, field });
		session.input(input);
		await session.save("enter");
		expect(session.state().phase).toBe(phase);
		if (phase === "closed") {
			expect(session.state().outcome).toBe("saved");
			expect(session.state().binding).toEqual(saved);
		} else {
			expect(session.state().error).toBe("stale");
			expect(session.state().text).toBe(" Name ");
		}
	},
);

it.each(["\r\n", "\r", "\n"])(
	"C06b lost reply adopts exact saved %j binding for the next save",
	async (ending) => {
		const opening = {
			...binding,
			kind: "body",
			field: "text",
			text: `First${ending}second.`,
			range: { start: 12, end: 25 + ending.length },
		};
		const admitted = {
			...opening,
			text: `Saved first${ending}second.`,
			range: { start: 12, end: 31 + ending.length },
			baseRevision: "b".repeat(64),
		};
		const calls: CanvasTextRequest[] = [];
		let snapshot = admitted;
		const session = createCanvasTextSession(
			{
				async apply(input) {
					calls.push(input);
					throw new Error("Lost reply");
				},
				async snapshot() {
					return { fields: [snapshot] };
				},
			},
			() => {},
		);
		session.open(opening);
		session.input("Saved first\nsecond.");
		await session.save("enter");
		expect(session.state().phase).toBe("closed");
		expect(session.state().outcome).toBe("saved");
		expect(session.state().binding).toEqual(admitted);
		session.open(session.state().binding ?? opening);
		session.input("Next first\nsecond.");
		snapshot = { ...admitted, text: "Outside edit", baseRevision: "c".repeat(64) };
		await session.save("enter");
		expect(calls[1]).toMatchObject({ expectedText: admitted.text, baseRevision: "b".repeat(64) });
		expect(session.state().error).toBe("stale");
	},
);

it.each(["\r\n", "\r", "\n"])(
	"C06b unchanged native %j paragraph closes with no request",
	async (ending) => {
		let calls = 0;
		const session = createCanvasTextSession(
			{
				async apply() {
					calls++;
					return { ok: false, code: "stale" };
				},
				async snapshot() {
					return { fields: [] };
				},
			},
			() => {},
		);
		session.open({ ...binding, text: `First${ending}second.` });
		session.input("First\nsecond.");
		await session.save("enter");
		expect(session.state().outcome).toBe("cancelled");
		expect(calls).toBe(0);
	},
);

function fixture() {
	let disk = original;
	let revision = binding.baseRevision;
	let readable = true;
	const calls: CanvasTextRequest[] = [];
	let reply: ((value: CanvasTextReply) => void) | undefined;
	let reject: ((error: Error) => void) | undefined;
	const session = createCanvasTextSession(
		{
			apply(input) {
				calls.push(input);
				return new Promise<CanvasTextReply>((resolve, fail) => {
					reply = resolve;
					reject = fail;
				});
			},
			async snapshot() {
				if (!readable) throw new Error("Saved bytes unavailable");
				return {
					fields: [
						{
							...binding,
							baseRevision: revision,
							text: disk.split("## ")[1]?.split("\n")[0] ?? "",
						},
					],
				};
			},
		},
		() => {},
	);
	return {
		session,
		calls,
		disk: () => disk,
		blockRead() {
			readable = false;
		},
		allowRead() {
			readable = true;
		},
		outside() {
			disk = disk.replace("Other.", "Outside.");
			revision = "c".repeat(64);
		},
		respond(
			kind: "success" | "refusal" | "unknown" | "unknown-saved",
			correspondence?: Extract<CanvasTextReply, { ok: true }>["correspondence"],
		) {
			const input = calls.at(-1);
			if (!input || !reply || !reject) return;
			if (kind === "success" || kind === "unknown-saved") {
				disk = disk.replace("## Before", `## ${input.text}`);
				revision = "b".repeat(64);
			}
			if (kind.startsWith("unknown")) reject(new Error("Lost reply"));
			else
				reply(
					kind === "success"
						? { ok: true, files: [{ path: binding.file, toRevision: revision }], correspondence }
						: { ok: false, code: "stale" },
				);
			reply = undefined;
			reject = undefined;
		},
	};
}

it("C08a a confirmed save promotes its binding through the issued identity correspondence", async () => {
	const f = fixture();
	f.session.open({ ...binding, nodeId: "rt-heading", ownerId: "rt-owner", pageId: "rt-page" });
	f.session.input("Saved *text*");
	const pending = f.session.save("enter");
	f.respond("success", [
		{ runtimeId: "rt-heading", durableId: "durable-heading" },
		{ runtimeId: "rt-owner", durableId: "durable-owner" },
		{ runtimeId: "rt-page", durableId: "durable-page" },
	]);
	await pending;
	expect(f.session.state()).toMatchObject({
		phase: "closed",
		outcome: "saved",
		binding: {
			nodeId: "durable-heading",
			ownerId: "durable-owner",
			pageId: "durable-page",
			text: "Saved *text*",
			baseRevision: "b".repeat(64),
		},
	});
	expect(f.disk()).toBe("# Page\n\n## Saved *text*\n\nOther.\n");
	expect(f.calls).toHaveLength(1);
});

it("C04 freezes a submission, coalesces Enter and blur, and Escape never saves", async () => {
	const f = fixture();
	f.session.open(binding);
	f.session.input("Exact *typed* text");
	const pending = f.session.save("enter");
	void f.session.save("blur");
	f.session.input("overwrite");
	f.session.cancel();
	expect(f.calls).toEqual([
		{
			transactionId: expect.any(String),
			operation: "setText",
			file: "lesson.prax",
			nodeId: "heading",
			baseRevision: "a".repeat(64),
			expectedText: "Before",
			field: "subject",
			text: "Exact *typed* text",
		},
	]);
	expect(f.session.state().phase).toBe("saving");
	expect(f.session.state().text).toBe("Exact *typed* text");
	f.respond("success");
	await pending;
	expect(f.session.state().phase).toBe("closed");
	expect(f.disk()).toBe("# Page\n\n## Exact *typed* text\n\nOther.\n");
	f.session.open(binding);
	f.session.input("Discard");
	f.session.cancel();
	void f.session.save("blur");
	expect(f.calls).toHaveLength(1);
});

it.each(["unknown", "unknown-saved"] as const)(
	"C04 checks saved bytes after %s before a retry",
	async (outcome) => {
		const f = fixture();
		f.session.open(binding);
		f.session.input("Kept");
		const pending = f.session.save("enter");
		f.respond(outcome);
		await pending;
		expect(f.session.state().phase).toBe(outcome === "unknown" ? "retry" : "closed");
		if (outcome === "unknown") {
			expect(f.session.state().text).toBe("Kept");
			const retry = f.session.retry();
			expect(f.calls).toHaveLength(2);
			expect(f.calls[1]).toEqual(f.calls[0]);
			f.respond("success");
			await retry;
		}
		expect(f.disk()).toBe("# Page\n\n## Kept\n\nOther.\n");
	},
);

it("C04 a corrected refused field still saves on blur", async () => {
	const f = fixture();
	f.session.open(binding);
	f.session.input("Refused");
	const refused = f.session.save("enter");
	f.respond("refusal");
	await refused;
	f.session.input("Corrected");
	const saved = f.session.save("blur");
	expect(f.calls).toHaveLength(2);
	f.respond("success");
	await saved;
	expect(f.disk()).toBe("# Page\n\n## Corrected\n\nOther.\n");
});

it("C04 a discarded unknown check cannot replace a newly opened field", async () => {
	let resolveSnapshot: ((value: { fields: CanvasTextBinding[] }) => void) | undefined;
	let finish: ((value: CanvasTextReply) => void) | undefined;
	let calls = 0;
	let started: (() => void) | undefined;
	const reading = new Promise<void>((resolve) => {
		started = resolve;
	});
	const session = createCanvasTextSession(
		{
			apply: async () => {
				if (calls++ === 0) throw new Error("Lost reply");
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
			snapshot: () =>
				new Promise((resolve) => {
					resolveSnapshot = resolve;
					started?.();
				}),
		},
		() => {},
	);
	session.open(binding);
	session.input("Old submission");
	const pending = session.save("enter");
	await reading;
	expect(session.cancel(true)).toBe(true);
	session.open({ ...binding, nodeId: "another-heading", text: "Another" });
	session.input("New unsaved text");
	const next = session.save("enter");
	resolveSnapshot?.({
		fields: [{ ...binding, text: "Old submission", baseRevision: "b".repeat(64) }],
	});
	await pending;
	expect(session.state().phase).toBe("saving");
	expect(session.state().binding?.nodeId).toBe("another-heading");
	expect(session.state().text).toBe("New unsaved text");
	finish?.({ ok: true, files: [{ path: binding.file, toRevision: "c".repeat(64) }] });
	await next;
});

// The model is the written single-field contract, independent of production state or matching.
for (const start of ["closed", "editing", "saving", "refused", "unknown"] as const) {
	it(`C04 generated histories from ${start} preserve requests, field text and disk bytes`, async () => {
		for (let seed = 1; seed <= 12; seed++) {
			const f = fixture();
			const model = {
				phase: "closed",
				text: "",
				calls: 0,
				disk: original,
				readable: true,
				submitted: "",
				kept: false,
			};
			let pending: Promise<void> | undefined;
			let random = seed * 1777;
			const run = async (action: string) => {
				switch (action) {
					case "open":
						if (model.phase === "closed") {
							model.phase = "editing";
							model.text = "Before";
							model.submitted = "";
							model.kept = false;
						}
						f.session.open(binding);
						break;
					case "type":
						if (model.phase === "editing") model.text = `Text ${random}`;
						f.session.input(`Text ${random}`);
						break;
					case "enter":
					case "blur":
						if (model.phase === "editing" && !model.kept && model.text === "Before") {
							model.phase = "closed";
							const unchanged = f.session.save(action);
							expect(f.calls).toHaveLength(model.calls);
							await unchanged;
						} else if (
							model.phase === "editing" &&
							!(action === "blur" && model.kept && model.text === model.submitted)
						) {
							model.phase = "saving";
							model.calls++;
							model.submitted = model.text;
							pending = f.session.save(action);
						} else void f.session.save(action);
						break;
					case "escape":
						if (model.phase !== "saving" && model.phase !== "closed" && !model.kept) {
							model.phase = "closed";
							model.text = "";
							model.submitted = "";
						}
						f.session.cancel();
						break;
					case "outside":
						model.disk = model.disk.replace("Other.", "Outside.");
						f.outside();
						break;
					case "retry":
						if (model.phase === "retry") {
							model.phase = "saving";
							model.calls++;
							pending = f.session.retry();
						} else void f.session.retry();
						break;
					case "check":
						model.readable = true;
						f.allowRead();
						if (model.phase === "unknown")
							model.phase = model.disk.includes(`## ${model.submitted}\n`)
								? "closed"
								: model.disk === original
									? "retry"
									: "editing";
						await f.session.check();
						break;
					case "success":
					case "refusal":
					case "unknown":
						if (model.phase === "saving") {
							if (action === "success") {
								model.disk = model.disk.replace("## Before", `## ${model.submitted}`);
								model.phase = "closed";
								model.text = "";
								model.submitted = "";
							} else if (action === "refusal") {
								model.phase = "editing";
								model.kept = true;
							} else if (!model.readable) {
								model.phase = "unknown";
								model.kept = true;
							} else if (model.disk.includes(`## ${model.submitted}\n`)) {
								model.phase = "closed";
								model.text = "";
								model.submitted = "";
							} else {
								model.phase = model.disk === original ? "retry" : "editing";
								model.kept = true;
							}
							f.respond(action);
							await pending;
						}
						break;
				}
				expect(f.calls.length, action).toBe(model.calls);
				expect(f.session.state().phase, action).toBe(model.phase);
				if (model.phase !== "closed") expect(f.session.state().text, action).toBe(model.text);
				expect(f.disk(), action).toBe(model.disk);
			};
			if (start !== "closed") await run("open");
			if (["saving", "refused", "unknown"].includes(start)) {
				await run("type");
				await run("enter");
			}
			if (start === "refused") await run("refusal");
			if (start === "unknown") {
				model.readable = false;
				f.blockRead();
				await run("unknown");
			}
			// Every starting state also proves an outside edit fences an unconfirmed retry.
			const outside = fixture();
			outside.session.open(binding);
			outside.outside();
			outside.session.input("Kept after outside edit");
			const unknown = outside.session.save("enter");
			outside.respond("unknown");
			await unknown;
			expect(outside.session.state().phase).toBe("editing");
			expect(outside.session.state().error).toBe("stale");
			expect(outside.disk()).toBe("# Page\n\n## Before\n\nOutside.\n");
			await outside.session.retry();
			expect(outside.calls).toHaveLength(1);
			// Each generator exercises both high-risk controls, even before random actions.
			for (const action of [
				"check",
				"retry",
				"success",
				"escape",
				"open",
				"type",
				"enter",
				"blur",
				"success",
				"open",
				"type",
				"escape",
				"open",
				"enter",
				"open",
				"blur",
				"open",
				"type",
				"enter",
				"refusal",
				"blur",
				"escape",
				"type",
				"enter",
				"success",
			])
				await run(action);
			for (let step = 0; step < 35; step++) {
				random ^= random << 13;
				random ^= random >>> 17;
				random ^= random << 5;
				random >>>= 0;
				await run(
					[
						"open",
						"type",
						"enter",
						"blur",
						"escape",
						"outside",
						"success",
						"refusal",
						"unknown",
						"retry",
						"check",
					][random % 11],
				);
			}
			f.respond("refusal");
			await pending;
		}
	});
}

const flowGeometry: CanvasTextGeometry = {
	connected: true,
	visible: true,
	box: { top: 100, bottom: 148, left: 8, right: 312, width: 304, height: 48 },
	minimum: { width: 304, height: 48 },
	scrollY: 0,
	viewport: { width: 320, height: 256 },
	focusDeparted: false,
	focused: true,
	cornersHit: true,
};

it.each([
	["uncovered in flow", {}, false],
	["covered in flow", { cornersHit: false }, true],
	["detached", { connected: false }, true],
	["hidden", { visible: false }, true],
	["lost focus", { focused: false }, true],
	["legitimate focus departure", { focused: false, focusDeparted: true, cornersHit: false }, false],
	[
		"minimum size boundary",
		{ box: { top: 100, bottom: 147, left: 8, right: 311, width: 303, height: 47 } },
		false,
	],
	[
		"below minimum width",
		{ box: { top: 100, bottom: 148, left: 8, right: 310, width: 302, height: 48 } },
		true,
	],
	[
		"below minimum height",
		{ box: { top: 100, bottom: 146, left: 8, right: 312, width: 304, height: 46 } },
		true,
	],
	[
		"scrolled out of view",
		{
			box: { top: -48, bottom: 0, left: 8, right: 312, width: 304, height: 48 },
			scrollY: 48,
			cornersHit: false,
		},
		false,
	],
	[
		"negative document position",
		{
			box: { top: -48, bottom: 0, left: 8, right: 312, width: 304, height: 48 },
			scrollY: 47,
			cornersHit: false,
		},
		true,
	],
	[
		"viewport bottom boundary",
		{
			box: { top: 208, bottom: 256, left: 8, right: 312, width: 304, height: 48 },
			cornersHit: false,
		},
		true,
	],
	[
		"below viewport",
		{
			box: { top: 209, bottom: 257, left: 8, right: 312, width: 304, height: 48 },
			cornersHit: false,
		},
		false,
	],
] satisfies [string, Partial<CanvasTextGeometry>, boolean][])(
	"C09b fallback admission: %s",
	(_name, geometry, expected) => {
		expect(canvasTextNeedsFallback({ ...flowGeometry, ...geometry })).toBe(expected);
	},
);
