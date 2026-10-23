import {
	create,
	listThreads,
	MAX_COMMENT_LENGTH,
	MAX_NAME_LENGTH,
	parseCommandPayload,
	parseReviewPrincipal,
	parseReviewState,
	parseReviewUuid,
	REVIEW_LIMITS,
	type ReviewAnchor,
	type ReviewCommandResult,
	type ReviewDeps,
	type ReviewPrincipal,
	type ReviewState,
	type ReviewVisibilityPolicy,
	reopen,
	reply,
	resolve,
	reviewVisibility,
	serializeReviewState,
} from "@praxity/review-share/review";
import { describe, expect, it } from "vitest";

const reviewId = "10000000-0000-4000-8000-000000000001";
it("admits canonical UUIDs directly and refuses uppercase request IDs", () => {
	expect(parseReviewUuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toEqual({
		ok: true,
		value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	});
	expect(parseReviewUuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toEqual({
		ok: false,
		code: "invalid_input",
		detail: { path: "$" },
	});
});
const threadId = "20000000-0000-4000-8000-000000000001";
const messageId = "20000000-0000-4000-8000-000000000002";
const requestId = "30000000-0000-4000-8000-000000000001";
const secondRequest = "30000000-0000-4000-8000-000000000002";
const thirdRequest = "30000000-0000-4000-8000-000000000003";
const fourthRequest = "30000000-0000-4000-8000-000000000004";
const at = "2026-10-18T12:00:00.000Z";
const later = "2026-10-18T12:01:00.000Z";
const reviewer: ReviewPrincipal = {
	id: "local-reviewer",
	displayName: "Ariel",
	role: "reviewer",
	provenance: "local-preview",
};
const author: ReviewPrincipal = {
	id: "cli-author",
	displayName: "Agent",
	role: "author",
	provenance: "local-cli",
};
const anchor: ReviewAnchor = {
	courseId: "course-one",
	lessonId: "lesson-one",
	pageId: "page-one",
	nodeId: "node-one",
	blockId: "block-one",
	revision: "build:lesson-sha256",
	quote: {
		type: "TextQuoteSelector",
		exact: "Original words",
		prefix: "Before ",
		suffix: " after",
	},
	pin: null,
	tab: null,
	revealPath: [],
	cssPath: null,
	context: { pageTitle: "First page", targetLabel: "Paragraph" },
};
function state(): ReviewState {
	return {
		schema: 1,
		reviewId,
		course: { namespace: "course-one", bound: true },
		changeSeq: 0,
		threads: [],
		receipts: [],
	};
}
function deps(start = 1, time = at): ReviewDeps {
	let next = start;
	return {
		now: () => time,
		uuid: () => `20000000-0000-4000-8000-${String(next++).padStart(12, "0")}`,
	};
}
function success(result: ReviewCommandResult) {
	if (!result.ok) throw new Error(JSON.stringify(result));
	return result;
}
function createPayload() {
	return { reviewId, requestId, anchor: structuredClone(anchor), body: "Please change this." };
}
async function created() {
	return success(await create(state(), reviewer, createPayload(), deps()));
}
function versioned(version = 1, request = secondRequest) {
	return { reviewId, threadId, expectVersion: version, requestId: request };
}
async function resolved() {
	const first = await created();
	return success(
		await resolve(
			first.state,
			author,
			{ ...versioned(), body: "Changed the words." },
			deps(3, later),
		),
	);
}
function invalidAt(result: unknown, path: string) {
	expect(result).toEqual({ ok: false, code: "invalid_input", detail: { path } });
}

it.each([false, true])(
	"replays a pre-upgrade C1 body only for the original actor and exact payload, legacy principal=%s",
	async (legacyPrincipal) => {
		const saved = await created();
		const actor = legacyPrincipal
			? { ...reviewer, id: "local\u009breviewer", displayName: "Local\u0085 user" }
			: reviewer;
		saved.state.threads[0].messages[0].actor = {
			id: actor.id,
			displayName: actor.displayName,
			role: actor.role,
		};
		saved.state.receipts[0].actorId = actor.id;
		const payload = { ...createPayload(), body: "Legacy\u009b comment" };
		saved.state.threads[0].messages[0].body = payload.body;
		// SHA-256 of the canonical pre-upgrade create payload, including the legacy body.
		saved.state.receipts[0].digest =
			"608d034f8438686c14499d5cc57a3d5e4ac5721889079adab6cc05cb757412de";
		const replayed = success(await create(saved.state, actor, payload, deps(10)));
		expect(replayed.replayed).toBe(true);
		expect(replayed.state).toEqual(saved.state);
		expect(replayed.thread.messages).toHaveLength(1);
		expect(replayed.thread.messages[0].body).toBe("Legacy\u009b comment");
		expect(
			await create(saved.state, actor, { ...payload, body: `${payload.body} changed` }, deps(10)),
		).toMatchObject({ ok: false, code: "request_id_reused" });
		invalidAt(
			await create(saved.state, actor, { ...payload, requestId: secondRequest }, deps(10)),
			legacyPrincipal ? "$.id" : "$.body",
		);
		invalidAt(await create(saved.state, author, payload, deps(10)), "$.body");
	},
);

it.each(Array.from({ length: 32 }, (_, n) => String.fromCharCode(0x80 + n)))(
	"refuses C1 control %# at every free-text admission",
	async (control) => {
		const value = `x${control}`;
		for (const field of [
			"courseId",
			"lessonId",
			"pageId",
			"nodeId",
			"blockId",
			"revision",
			"tab",
			"cssPath",
		]) {
			const payload = createPayload();
			Object.assign(payload.anchor, { [field]: value });
			invalidAt(parseCommandPayload("create", payload), `$.anchor.${field}`);
			invalidAt(await create(state(), reviewer, payload, deps()), `$.anchor.${field}`);
		}
		for (const field of ["exact", "prefix", "suffix"]) {
			const payload = createPayload();
			Object.assign(payload.anchor.quote ?? {}, { [field]: value });
			invalidAt(parseCommandPayload("create", payload), `$.anchor.quote.${field}`);
		}
		for (const field of ["pageTitle", "targetLabel"]) {
			const payload = createPayload();
			Object.assign(payload.anchor.context, { [field]: value });
			invalidAt(parseCommandPayload("create", payload), `$.anchor.context.${field}`);
		}
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, revealPath: [value] },
			}),
			"$.anchor.revealPath[0]",
		);
		for (const field of ["id", "displayName"]) {
			invalidAt(parseReviewPrincipal({ ...reviewer, [field]: value }), `$.${field}`);
			invalidAt(
				await create(state(), { ...reviewer, [field]: value }, createPayload(), deps()),
				`$.${field}`,
			);
		}
		invalidAt(parseCommandPayload("create", { ...createPayload(), body: value }), "$.body");
		invalidAt(
			await create(state(), reviewer, { ...createPayload(), body: value }, deps()),
			"$.body",
		);
		for (const kind of ["reply", "resolve"] as const)
			invalidAt(parseCommandPayload(kind, { ...versioned(), body: value }), "$.body");
	},
);

it.each([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])(
	"refuses bidi control %i in bodies but preserves RTL quotes and labels",
	async (code) => {
		const value = `RTL ${String.fromCharCode(code)}עברית`;
		invalidAt(parseCommandPayload("create", { ...createPayload(), body: value }), "$.body");
		invalidAt(
			await create(state(), reviewer, { ...createPayload(), body: value }, deps()),
			"$.body",
		);
		for (const kind of ["reply", "resolve"] as const)
			invalidAt(parseCommandPayload(kind, { ...versioned(), body: value }), "$.body");
		const payload = createPayload();
		payload.anchor.quote = {
			type: "TextQuoteSelector",
			exact: value,
			prefix: value,
			suffix: value,
		};
		payload.anchor.context = { pageTitle: value, targetLabel: value };
		expect(parseCommandPayload("create", payload)).toEqual({ ok: true, value: payload });
	},
);

it("loads and lists existing state with C1 and bidi characters unchanged", async () => {
	const saved = (await created()).state;
	const value = "old\u0080\u009f\u202e\u2066";
	saved.course.namespace = value;
	Object.assign(saved.threads[0].anchor, {
		courseId: value,
		lessonId: value,
		pageId: value,
		nodeId: value,
		blockId: value,
		revision: value,
		tab: value,
		revealPath: [value],
		cssPath: value,
	});
	saved.threads[0].anchor.quote = {
		type: "TextQuoteSelector",
		exact: value,
		prefix: value,
		suffix: value,
	};
	saved.threads[0].anchor.context = { pageTitle: value, targetLabel: value };
	saved.threads[0].messages[0].body = value;
	saved.threads[0].messages[0].actor.id = value;
	saved.threads[0].messages[0].actor.displayName = value;
	saved.receipts[0].actorId = value;
	expect(parseReviewState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true, value: saved });
	const listed = await listThreads(saved, author);
	expect(listed).toMatchObject({ threads: saved.threads });
	const updated = success(
		await reply(saved, author, { ...versioned(), body: "A new safe reply" }, deps(10)),
	);
	expect(parseReviewState(updated.state).ok).toBe(true);
	expect(updated.thread.messages[0].body).toBe(value);
});

describe("review lifecycle", () => {
	it.each([
		["reviewer", 3670016],
		["author", 4194304],
	] as const)("bounds serialized UTF-8 state for %s at %i bytes", async (role, bytes) => {
		const first = await created();
		const full = {
			...first.state,
			receipts: [],
			changeSeq: 1100,
			threads: [
				{
					...first.thread,
					version: 1100,
					messages: Array.from({ length: 1100 }, (_, index) => ({
						...first.thread.messages[0],
						id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
						body: "x".repeat(2000),
					})),
				},
			],
		};
		let remaining = bytes - new TextEncoder().encode(JSON.stringify(full)).length;
		for (const message of full.threads[0].messages) {
			const extra = Math.min(remaining, 2000);
			message.body = "é".repeat(extra) + "x".repeat(2000 - extra);
			remaining -= extra;
		}
		expect(remaining).toBe(0);
		expect(parseReviewState(full).ok).toBe(true);
		const atLimit = serializeReviewState(full, role);
		expect(atLimit.ok).toBe(true);
		if (!atLimit.ok) throw new Error("Refused exact byte limit");
		expect(new TextEncoder().encode(atLimit.value).length).toBe(bytes);
		const message = full.threads[0].messages.find((message) => message.body.includes("x"));
		if (!message) throw new Error("Missing boundary fixture padding");
		message.body = message.body.replace("x", "é");
		expect(new TextEncoder().encode(JSON.stringify(full)).length).toBe(bytes + 1);
		const over = serializeReviewState(full, role);
		expect(over.ok).toBe(false);
		if (!over.ok)
			expect(over).toEqual({ ok: false, code: "limit_reached", detail: { path: "$.bytes" } });
	});
	it.each(
		Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).filter(
			(control) => control !== "\n" && control !== "\t",
		),
	)("refuses C0 control %# in free text", (control) => {
		const payload = createPayload();
		if (!anchor.quote) throw new Error("Missing quote fixture");
		for (const value of [
			{ ...payload, body: `x${control}` },
			{ ...payload, anchor: { ...anchor, revision: `x${control}` } },
			{ ...payload, anchor: { ...anchor, cssPath: `x${control}` } },
			{ ...payload, anchor: { ...anchor, quote: { ...anchor.quote, exact: `x${control}` } } },
			{ ...payload, anchor: { ...anchor, quote: { ...anchor.quote, prefix: control } } },
			{ ...payload, anchor: { ...anchor, quote: { ...anchor.quote, suffix: control } } },
			{
				...payload,
				anchor: { ...anchor, context: { pageTitle: `x${control}`, targetLabel: null } },
			},
			{
				...payload,
				anchor: { ...anchor, context: { pageTitle: null, targetLabel: `x${control}` } },
			},
		])
			expect(parseCommandPayload("create", value).ok).toBe(false);
	});
	it("preserves line feeds and tabs in free text", () => {
		expect(parseCommandPayload("create", { ...createPayload(), body: "Line\n\tIndented" }).ok).toBe(
			true,
		);
	});
	it("preserves CRLF body bytes through create, reply, resolve and stored-state parsing", async () => {
		const first = success(
			await create(state(), reviewer, { ...createPayload(), body: "Opening\r\nbody" }, deps()),
		);
		const second = success(
			await reply(first.state, author, { ...versioned(), body: "Reply\r\n\tbody" }, deps(10)),
		);
		const third = success(
			await resolve(
				second.state,
				author,
				{ ...versioned(2, thirdRequest), body: "Resolved\r\nbody\r\n" },
				deps(20),
			),
		);
		expect(third.thread.messages.map((message) => message.body)).toEqual([
			"Opening\r\nbody",
			"Reply\r\n\tbody",
			"Resolved\r\nbody\r\n",
		]);
		expect(parseReviewState(third.state)).toEqual({ ok: true, value: third.state });
	});
	it.each(["x\r", "x\ry", "x\r\r\n", "x\r\n\ry"])("refuses a lone CR in a body: %j", (body) => {
		invalidAt(parseCommandPayload("create", { ...createPayload(), body }), "$.body");
		invalidAt(parseCommandPayload("reply", { ...versioned(), body }), "$.body");
		invalidAt(parseCommandPayload("resolve", { ...versioned(), body }), "$.body");
	});
	it.each(["\r", "\r\n"])("refuses CR outside message bodies: %j", (control) => {
		if (!anchor.quote) throw new Error("Missing quote fixture");
		for (const field of ["exact", "prefix", "suffix"] as const) {
			invalidAt(
				parseCommandPayload("create", {
					...createPayload(),
					anchor: { ...anchor, quote: { ...anchor.quote, [field]: `x${control}` } },
				}),
				`$.anchor.quote.${field}`,
			);
		}
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, context: { pageTitle: `x${control}`, targetLabel: null } },
			}),
			"$.anchor.context.pageTitle",
		);
		invalidAt(parseReviewPrincipal({ ...reviewer, displayName: `x${control}` }), "$.displayName");
	});
	it("admits mutation 100000, refuses 100001, and replays at capacity", async () => {
		const first = await created();
		const full = {
			...first.state,
			changeSeq: 99999,
			threads: [{ ...first.thread, version: 99999 }],
			receipts: Array.from({ length: 99999 }, (_, index) => ({
				actorId: reviewer.id,
				requestId: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
				digest: "0".repeat(64),
				threadId,
				version: index + 1,
				messageId: index === 0 ? messageId : null,
			})),
		};
		expect(parseReviewState(full).ok).toBe(true);
		const admitted = success(await reopen(full, reviewer, versioned(99999), deps(5000)));
		expect(admitted.state.receipts).toHaveLength(100000);
		expect(
			await reopen(admitted.state, reviewer, versioned(100000, thirdRequest), deps(5000)),
		).toEqual({
			ok: false,
			code: "limit_reached",
			detail: { path: "$.receipts" },
		});
		const retry = success(await reopen(admitted.state, reviewer, versioned(99999), deps(5000)));
		expect(retry.replayed).toBe(true);
		expect(retry.receipt).toEqual(admitted.receipt);
		expect(retry.state.receipts).toHaveLength(100000);
		expect(REVIEW_LIMITS.mutationsPerReview).toBe(100000);
		for (const command of [reply, resolve]) {
			const response = success(
				await command(
					admitted.state,
					author,
					{ ...versioned(100000, thirdRequest), body: "Author response at capacity" },
					deps(5001),
				),
			);
			expect(response.state.receipts).toHaveLength(100001);
		}
		expect(
			await create(
				admitted.state,
				author,
				{ ...createPayload(), requestId: thirdRequest },
				deps(5001),
			),
		).toEqual({ ok: false, code: "limit_reached", detail: { path: "$.receipts" } });
	});
	it.each([reviewer, author])(
		"admits the 1000th thread, refuses the 1001st, and replays at capacity for $role",
		async (principal) => {
			const first = await created();
			const full = {
				...first.state,
				changeSeq: 999,
				threads: Array.from({ length: 999 }, (_, index) => ({
					...structuredClone(first.thread),
					id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
					messages: [
						{
							...first.thread.messages[0],
							id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
						},
					],
				})),
				receipts: [],
			};
			expect(parseReviewState(full).ok).toBe(true);
			const payload = { ...createPayload(), requestId: secondRequest };
			const admitted = success(await create(full, principal, payload, deps(5000)));
			expect(admitted.state.threads).toHaveLength(1000);
			expect(
				await create(
					admitted.state,
					principal,
					{ ...payload, requestId: thirdRequest },
					deps(5002),
				),
			).toEqual({
				ok: false,
				code: "limit_reached",
				detail: { path: "$.threads" },
			});
			const retry = success(await create(admitted.state, principal, payload, deps(5002)));
			expect(retry.replayed).toBe(true);
			expect(retry.receipt).toEqual(admitted.receipt);
			expect(retry.state.threads).toHaveLength(1000);
			expect(REVIEW_LIMITS.threadsPerReview).toBe(1000);
		},
	);
	it.each([reply])(
		"admits reviewer message 100, refuses 101, and replays at capacity with %s",
		async (command) => {
			const first = await created();
			const full = {
				...first.state,
				changeSeq: 99,
				threads: [
					{
						...first.thread,
						version: 99,
						messages: Array.from({ length: 99 }, (_, index) => ({
							...first.thread.messages[0],
							id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
						})),
					},
				],
				receipts: [],
			};
			expect(parseReviewState(full).ok).toBe(true);
			const payload = { ...versioned(99), body: "Last message" };
			const admitted = success(await command(full, reviewer, payload, deps(5000)));
			expect(admitted.thread.messages).toHaveLength(100);
			expect(
				await command(
					admitted.state,
					reviewer,
					{ ...payload, expectVersion: 100, requestId: thirdRequest },
					deps(5001),
				),
			).toEqual({
				ok: false,
				code: "limit_reached",
				detail: { path: "$.messages" },
			});
			const retry = success(await command(admitted.state, reviewer, payload, deps(5001)));
			expect(retry.replayed).toBe(true);
			expect(retry.receipt).toEqual(admitted.receipt);
			expect(retry.thread.messages).toHaveLength(100);
			expect(REVIEW_LIMITS.messagesPerThread).toBe(100);
			for (const response of [reply, resolve]) {
				const result = success(
					await response(
						admitted.state,
						author,
						{ ...payload, expectVersion: 100, requestId: thirdRequest },
						deps(5001),
					),
				);
				expect(result.thread.messages).toHaveLength(101);
			}
		},
	);
	it("creates literal records, preserving input and separating returned thread from state", async () => {
		const initial = state();
		const payload = createPayload();
		const result = success(await create(initial, reviewer, payload, deps()));
		expect(result.thread).toEqual({
			id: threadId,
			reviewId,
			anchor,
			status: "open",
			version: 1,
			createdAt: at,
			updatedAt: at,
			messages: [
				{
					id: messageId,
					body: "Please change this.",
					actor: { id: "local-reviewer", displayName: "Ariel", role: "reviewer" },
					at,
					provenance: "local-preview",
				},
			],
			resolution: null,
		});
		expect(result.replayed).toBe(false);
		expect(result.receipt).toEqual({ threadId, version: 1, messageId });
		expect(result.state.changeSeq).toBe(1);
		expect(result.state.receipts).toEqual([
			{
				actorId: "local-reviewer",
				requestId,
				digest: expect.stringMatching(/^[a-f0-9]{64}$/),
				threadId,
				version: 1,
				messageId,
			},
		]);
		expect(initial).toEqual({
			schema: 1,
			reviewId,
			course: { namespace: "course-one", bound: true },
			changeSeq: 0,
			threads: [],
			receipts: [],
		});
		payload.anchor.context.pageTitle = "Changed input";
		result.thread.messages[0].body = "Changed result";
		expect(result.state.threads[0].anchor.context.pageTitle).toBe("First page");
		expect(result.state.threads[0].messages[0].body).toBe("Please change this.");
	});
	it("replies and atomically resolves with literal messages and resolution", async () => {
		const first = await created();
		const second = success(
			await reply(first.state, author, { ...versioned(), body: "Checking this." }, deps(3, later)),
		);
		expect(second.thread.messages[1]).toEqual({
			id: "20000000-0000-4000-8000-000000000003",
			body: "Checking this.",
			actor: { id: "cli-author", displayName: "Agent", role: "author" },
			at: later,
			provenance: "local-cli",
		});
		expect(second.receipt).toEqual({
			threadId,
			version: 2,
			messageId: "20000000-0000-4000-8000-000000000003",
		});
		expect(second.thread).toMatchObject({
			status: "open",
			version: 2,
			createdAt: at,
			updatedAt: later,
			resolution: null,
		});
		const third = success(
			await resolve(
				second.state,
				author,
				{ ...versioned(2, thirdRequest), body: "Fixed." },
				deps(4, "2026-10-18T12:02:00.000Z"),
			),
		);
		expect(third.thread.messages[2]).toEqual({
			id: "20000000-0000-4000-8000-000000000004",
			body: "Fixed.",
			actor: { id: "cli-author", displayName: "Agent", role: "author" },
			at: "2026-10-18T12:02:00.000Z",
			provenance: "local-cli",
		});
		expect(third.thread).toMatchObject({
			status: "resolved",
			version: 3,
			updatedAt: "2026-10-18T12:02:00.000Z",
			resolution: { actorId: "cli-author", at: "2026-10-18T12:02:00.000Z" },
		});
		expect(third.state.changeSeq).toBe(3);
		expect(third.receipt).toEqual({
			threadId,
			version: 3,
			messageId: "20000000-0000-4000-8000-000000000004",
		});
		expect(first.thread.messages).toHaveLength(1);
		expect(parseReviewState(JSON.parse(JSON.stringify(third.state)))).toEqual({
			ok: true,
			value: third.state,
		});
	});
	it("reviewer reply reopens; author reply retains resolved status and original resolution", async () => {
		const done = await resolved();
		const note = success(
			await reply(
				done.state,
				author,
				{ ...versioned(2, thirdRequest), body: "More detail." },
				deps(4),
			),
		);
		expect(note.thread).toMatchObject({
			status: "resolved",
			version: 3,
			resolution: { actorId: "cli-author", at: later },
		});
		const feedback = success(
			await reply(
				note.state,
				reviewer,
				{ ...versioned(3, fourthRequest), body: "Still needs work." },
				deps(5),
			),
		);
		expect(feedback.thread).toMatchObject({ status: "open", version: 4, resolution: null });
		expect(feedback.state.changeSeq).toBe(4);
	});
	it.each([reviewer, author])(
		"$role may create and explicitly reopen without appending a message",
		async (principal) => {
			expect((await create(state(), principal, createPayload(), deps())).ok).toBe(true);
			const done = await resolved();
			const result = success(
				await reopen(done.state, principal, versioned(2, thirdRequest), deps(4)),
			);
			expect(result.thread).toMatchObject({
				status: "open",
				version: 3,
				updatedAt: at,
				resolution: null,
			});
			expect(result.thread.messages).toHaveLength(2);
			expect(result.receipt).toEqual({ threadId, version: 3, messageId: null });
			expect(result.state.changeSeq).toBe(3);
			const again = success(
				await reopen(result.state, principal, versioned(3, fourthRequest), deps(4)),
			);
			expect(again.thread.version).toBe(4);
		},
	);
	it("refuses reviewer resolve, unexpected roles, wrong review, unknown thread and stale versions", async () => {
		const initial = await created();
		expect(
			await resolve(initial.state, reviewer, { ...versioned(), body: "Done" }, deps()),
		).toEqual({ ok: false, code: "forbidden", detail: {} });
		expect(
			await create(
				state(),
				{ ...reviewer, role: "admin" } as unknown as ReviewPrincipal,
				createPayload(),
				deps(),
			),
		).toEqual({ ok: false, code: "forbidden", detail: {} });
		expect(
			await create(
				state(),
				reviewer,
				{ ...createPayload(), reviewId: "90000000-0000-4000-8000-000000000001" },
				deps(),
			),
		).toEqual({ ok: false, code: "wrong_review", detail: {} });
		expect(
			await reply(
				initial.state,
				author,
				{ ...versioned(), threadId: "90000000-0000-4000-8000-000000000001", body: "Reply" },
				deps(),
			),
		).toEqual({ ok: false, code: "not_found", detail: {} });
		expect(await reply(initial.state, author, { ...versioned(2), body: "Reply" }, deps())).toEqual({
			ok: false,
			code: "stale_version",
			detail: { currentVersion: 1 },
		});
		expect(initial.state.changeSeq).toBe(1);
	});
	it("rejects cross-course anchors and preserves explicitly unbound runtime anchors", async () => {
		expect(
			await create(
				state(),
				reviewer,
				{ ...createPayload(), anchor: { ...anchor, courseId: "foreign" } },
				deps(),
			),
		).toEqual({ ok: false, code: "wrong_review", detail: { path: "$.anchor.courseId" } });
		const unbound: ReviewState = { ...state(), course: { namespace: null, bound: false } };
		const result = success(
			await create(
				unbound,
				reviewer,
				{ ...createPayload(), anchor: { ...anchor, courseId: null, nodeId: null, blockId: null } },
				deps(),
			),
		);
		expect(result.thread.anchor).toMatchObject({ courseId: null, nodeId: null, blockId: null });
		expect(parseReviewState(result.state).ok).toBe(true);
		expect((await create(unbound, reviewer, createPayload(), deps())).ok).toBe(false);
	});
	it("refuses an old-version resolve after new reviewer feedback without changing any state", async () => {
		const first = await created();
		const feedback = success(
			await reply(first.state, reviewer, { ...versioned(), body: "New feedback." }, deps(3, later)),
		);
		const before = structuredClone(feedback.state);
		expect(
			await resolve(
				feedback.state,
				author,
				{ ...versioned(1, thirdRequest), body: "Fixed." },
				deps(4),
			),
		).toEqual({ ok: false, code: "stale_version", detail: { currentVersion: 2 } });
		expect(feedback.state).toEqual(before);
		expect(feedback.state.threads[0].status).toBe("open");
		expect(feedback.state.threads[0].messages.map((message) => message.body)).toEqual([
			"Please change this.",
			"New feedback.",
		]);
		expect(feedback.state.receipts).toHaveLength(2);
		expect(feedback.state.changeSeq).toBe(2);
	});
	it("an unbound review refuses non-null course IDs even when its namespace matches", async () => {
		const unbound: ReviewState = { ...state(), course: { namespace: "course-one", bound: false } };
		expect(await create(unbound, reviewer, createPayload(), deps())).toEqual({
			ok: false,
			code: "wrong_review",
			detail: { path: "$.anchor.courseId" },
		});
		const stored = (await created()).state;
		stored.course.bound = false;
		invalidAt(parseReviewState(stored), "$.threads[0].anchor.courseId");
	});
	it("binding a review preserves old unbound anchors and admits new unbound anchors", async () => {
		const unbound: ReviewState = { ...state(), course: { namespace: null, bound: false } };
		const old = success(
			await create(
				unbound,
				reviewer,
				{ ...createPayload(), anchor: { ...anchor, courseId: null } },
				deps(),
			),
		);
		const bound: ReviewState = { ...old.state, course: { namespace: "course-one", bound: true } };
		expect(parseReviewState(bound)).toEqual({ ok: true, value: bound });
		const next = success(
			await create(
				bound,
				reviewer,
				{ ...createPayload(), requestId: secondRequest, anchor: { ...anchor, courseId: null } },
				deps(3),
			),
		);
		expect(next.thread.anchor.courseId).toBeNull();
		expect(
			success(
				await create(bound, reviewer, { ...createPayload(), requestId: secondRequest }, deps(3)),
			).thread.anchor.courseId,
		).toBe("course-one");
		expect(
			await create(
				bound,
				reviewer,
				{
					...createPayload(),
					requestId: secondRequest,
					anchor: { ...anchor, courseId: "foreign" },
				},
				deps(3),
			),
		).toEqual({ ok: false, code: "wrong_review", detail: { path: "$.anchor.courseId" } });
		const foreign = structuredClone(bound);
		foreign.threads[0].anchor.courseId = "foreign";
		invalidAt(parseReviewState(foreign), "$.threads[0].anchor.courseId");
	});
});

describe("durable idempotency", () => {
	it("resolve replay reports the current open thread after newer reviewer feedback", async () => {
		const done = await resolved();
		const feedback = success(
			await reply(
				done.state,
				reviewer,
				{ ...versioned(2, thirdRequest), body: "Still needs work." },
				deps(4),
			),
		);
		const before = structuredClone(feedback.state);
		const replay = success(
			await resolve(feedback.state, author, { ...versioned(), body: "Changed the words." }, deps()),
		);
		expect(replay.thread.status).toBe("open");
		expect(replay.thread.version).toBe(3);
		expect(replay.thread.messages).toHaveLength(3);
		expect(replay.replayed).toBe(true);
		expect(replay).toHaveProperty("receipt", {
			threadId,
			version: 2,
			messageId: "20000000-0000-4000-8000-000000000003",
		});
		expect(replay.state).toBe(feedback.state);
		expect(replay.state).toEqual(before);
	});
	it("creation retries return the current thread and original receipt without dependencies or state changes", async () => {
		const done = await resolved();
		const stored = parseReviewState(JSON.parse(JSON.stringify(done.state)));
		if (!stored.ok) throw new Error("Invalid fixture");
		const noDeps = {
			now: () => {
				throw new Error("Replay called clock");
			},
			uuid: () => {
				throw new Error("Replay minted ID");
			},
		};
		const replay = success(
			await create(stored.value, { ...reviewer, displayName: "Renamed" }, createPayload(), noDeps),
		);
		expect(replay.state).toBe(stored.value);
		expect(replay.replayed).toBe(true);
		expect(replay.thread).toMatchObject({
			status: "resolved",
			version: 2,
			resolution: { actorId: "cli-author", at: later },
			updatedAt: later,
		});
		expect(replay.thread.messages).toHaveLength(2);
		expect(replay.receipt).toEqual({ threadId, version: 1, messageId });
		expect(replay.thread.messages[0].actor.displayName).toBe("Ariel");
		expect(replay.state.changeSeq).toBe(2);
	});
	it("resolve and reply retries precede stale checking and survive JSON persistence", async () => {
		const first = await created();
		const payload = { ...versioned(), body: "A reply" };
		const second = success(await reply(first.state, author, payload, deps(3)));
		const third = success(
			await resolve(
				second.state,
				author,
				{ ...versioned(2, thirdRequest), body: "Done" },
				deps(4, later),
			),
		);
		const replay = success(await reply(third.state, author, payload, deps()));
		expect(replay.replayed).toBe(true);
		expect(replay.thread).toEqual(third.thread);
		expect(replay.thread.messages).toHaveLength(3);
		expect(replay.receipt).toEqual({
			threadId,
			version: 2,
			messageId: "20000000-0000-4000-8000-000000000003",
		});
		expect(replay.state).toBe(third.state);
		const doneReplay = success(
			await resolve(
				JSON.parse(JSON.stringify(third.state)),
				author,
				{ body: "Done", requestId: thirdRequest, expectVersion: 2, threadId, reviewId },
				deps(),
			),
		);
		expect(doneReplay.thread).toEqual(third.thread);
		expect(doneReplay.replayed).toBe(true);
	});
	it("reopen replay returns current status and original outcome after a later resolve", async () => {
		const done = await resolved();
		const opened = success(await reopen(done.state, reviewer, versioned(2, thirdRequest), deps(4)));
		const redone = success(
			await resolve(
				opened.state,
				author,
				{ ...versioned(3, fourthRequest), body: "Fixed again" },
				deps(4, later),
			),
		);
		const replay = success(
			await reopen(redone.state, reviewer, versioned(2, thirdRequest), deps()),
		);
		expect(replay.thread).toEqual(redone.thread);
		expect(replay.receipt).toEqual({ threadId, version: 3, messageId: null });
		expect(replay.state).toBe(redone.state);
	});
	it("binds actor, full payload and command kind; property order does not change digest", async () => {
		const first = await created();
		expect(
			await create(first.state, reviewer, { ...createPayload(), body: "Different" }, deps()),
		).toEqual({ ok: false, code: "request_id_reused", detail: {} });
		const note = success(
			await reply(first.state, author, { ...versioned(), body: "Same" }, deps(3)),
		);
		expect(await resolve(note.state, author, { ...versioned(), body: "Same" }, deps())).toEqual({
			ok: false,
			code: "request_id_reused",
			detail: {},
		});
		expect(await reply(note.state, author, { ...versioned(2), body: "Same" }, deps())).toEqual({
			ok: false,
			code: "request_id_reused",
			detail: {},
		});
		const own = success(await create(first.state, author, createPayload(), deps(3)));
		expect(own.state.threads).toHaveLength(2);
		const reordered = {
			body: "Please change this.",
			anchor: { ...anchor, context: { targetLabel: "Paragraph", pageTitle: "First page" } },
			requestId,
			reviewId,
		};
		expect(success(await create(first.state, reviewer, reordered, deps())).replayed).toBe(true);
	});
});

describe("strict input and literal bounds", () => {
	it.each(["__proto__", "constructor"])("refuses own %s keys in payloads and state", (key) => {
		const payload = JSON.parse(`${JSON.stringify(createPayload()).slice(0, -1)},"${key}":{}}`);
		const stored = JSON.parse(`${JSON.stringify(state()).slice(0, -1)},"${key}":{}}`);
		invalidAt(parseCommandPayload("create", payload), `$.${key}`);
		invalidAt(parseReviewState(stored), `$.${key}`);
	});
	it("refuses principal extra fields and counts emoji in UTF-16 units", async () => {
		invalidAt(
			await create(state(), { ...author, admin: true } as ReviewPrincipal, createPayload(), deps()),
			"$.admin",
		);
		invalidAt(
			parseCommandPayload("create", { ...createPayload(), body: `${"\u{1F600}".repeat(1000)}x` }),
			"$.body",
		);
	});
	it.each([
		" leading",
		"trailing ",
		"inside\ncontrol",
		"inside\u0000control",
		"inside\u001fcontrol",
	])("refuses malformed IDs %#", (value) => {
		invalidAt(
			parseCommandPayload("create", { ...createPayload(), anchor: { ...anchor, nodeId: value } }),
			"$.anchor.nodeId",
		);
		invalidAt(
			parseReviewState({ ...state(), course: { namespace: value, bound: true } }),
			"$.course.namespace",
		);
	});
	it("exports a frozen bounds object and the legacy constants", () => {
		expect(MAX_NAME_LENGTH).toBe(60);
		expect(MAX_COMMENT_LENGTH).toBe(2000);
		expect(REVIEW_LIMITS).toEqual({
			name: 60,
			body: 2000,
			quoteExact: 2000,
			quoteContext: 32,
			requestBodyBytes: 65536,
			stateBytes: 4194304,
			authorReserveBytes: 524288,
			id: 200,
			revision: 500,
			title: 500,
			pinPath: 512,
			pinDepth: 16,
			revealDepth: 16,
			cssPath: 2048,
			listLimit: 100,
			cursor: 2048,
			threadsPerReview: 1000,
			messagesPerThread: 100,
			mutationsPerReview: 100000,
		});
		expect(Object.isFrozen(REVIEW_LIMITS)).toBe(true);
	});
	it.each(["", " \t\n", "x".repeat(2001), "bad\ud800", "bad\udfff"])(
		"refuses invalid body %#",
		(body) => {
			invalidAt(parseCommandPayload("create", { ...createPayload(), body }), "$.body");
			invalidAt(parseCommandPayload("reply", { ...versioned(), body }), "$.body");
			invalidAt(parseCommandPayload("resolve", { ...versioned(), body }), "$.body");
		},
	);
	it.each(["x".repeat(2000), "😀".repeat(1000), "  retain whitespace  "])(
		"accepts body unchanged at literal boundaries %#",
		(body) => {
			expect(parseCommandPayload("create", { ...createPayload(), body })).toEqual({
				ok: true,
				value: { ...createPayload(), body },
			});
		},
	);
	it("validates principal name boundaries without clamping", async () => {
		expect(
			success(
				await create(
					state(),
					{ ...reviewer, displayName: "n".repeat(60) },
					createPayload(),
					deps(),
				),
			).thread.messages[0].actor.displayName,
		).toBe("n".repeat(60));
		invalidAt(
			await create(state(), { ...reviewer, displayName: "n".repeat(61) }, createPayload(), deps()),
			"$.displayName",
		);
	});
	it.each([
		["courseId", 200],
		["lessonId", 200],
		["pageId", 200],
		["nodeId", 200],
		["blockId", 200],
		["tab", 200],
		["revision", 500],
		["cssPath", 2048],
	] as const)("bounds anchor %s", (key, max) => {
		const payload = createPayload();
		payload.anchor[key] = "x".repeat(max);
		expect(parseCommandPayload("create", payload).ok).toBe(true);
		payload.anchor[key] = "x".repeat(max + 1);
		invalidAt(parseCommandPayload("create", payload), `$.anchor.${key}`);
	});
	it.each(["pageTitle", "targetLabel"] as const)("bounds context %s", (key) => {
		const payload = createPayload();
		payload.anchor.context[key] = "x".repeat(500);
		expect(parseCommandPayload("create", payload).ok).toBe(true);
		payload.anchor.context[key] = "x".repeat(501);
		invalidAt(parseCommandPayload("create", payload), `$.anchor.context.${key}`);
	});
	it.each([
		["exact", 2000],
		["prefix", 32],
		["suffix", 32],
	] as const)("bounds quote %s and rejects lone surrogates", (key, max) => {
		const quote = {
			type: "TextQuoteSelector" as const,
			exact: "text",
			prefix: "",
			suffix: "",
			[key]: "x".repeat(max),
		};
		expect(
			parseCommandPayload("create", { ...createPayload(), anchor: { ...anchor, quote } }).ok,
		).toBe(true);
		for (const value of ["x".repeat(max + 1), "\ud800", "\udc00"]) {
			invalidAt(
				parseCommandPayload("create", {
					...createPayload(),
					anchor: { ...anchor, quote: { ...quote, [key]: value } },
				}),
				`$.anchor.quote.${key}`,
			);
		}
	});
	it("bounds reveal path and its entries", () => {
		expect(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, revealPath: Array(16).fill("x".repeat(200)) },
			}).ok,
		).toBe(true);
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, revealPath: Array(17).fill("x") },
			}),
			"$.anchor.revealPath",
		);
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, revealPath: ["x".repeat(201)] },
			}),
			"$.anchor.revealPath[0]",
		);
	});
	it("accepts pin boundaries, self target and direct-child paths", () => {
		for (const path of [
			"",
			"a:nth-of-type(1) > span:nth-of-type(2)",
			`${"a".repeat(497)}:nth-of-type(1)`,
			Array(16).fill("a:nth-of-type(1)").join(" > "),
		]) {
			expect(
				parseCommandPayload("create", {
					...createPayload(),
					anchor: { ...anchor, pin: { path, x: 0, y: 1 } },
				}).ok,
			).toBe(true);
		}
	});
	it.each([
		"a:nth-of-type(0)",
		"A:nth-of-type(1)",
		"a:nth-of-type(-1)",
		"a:nth-of-type(1.5)",
		"a:nth-of-type(01)",
		"a:nth-of-type(9007199254740992)",
		"a b",
		"a:nth-of-type(1), b:nth-of-type(1)",
		`${"a".repeat(498)}:nth-of-type(1)`,
		Array(17).fill("a:nth-of-type(1)").join(" > "),
	])("refuses unsafe or oversized pin path %#", (path) => {
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, pin: { path, x: 0, y: 0 } },
			}),
			"$.anchor.pin.path",
		);
	});
	it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0"])(
		"refuses pin coordinates %#",
		(x) => {
			invalidAt(
				parseCommandPayload("create", {
					...createPayload(),
					anchor: { ...anchor, pin: { path: "", x, y: 0 } },
				}),
				"$.anchor.pin.x",
			);
		},
	);
	it("requires all anchor fields, valid UUIDs and no payload principal or write authority", () => {
		const { pageId: _page, ...missingPage } = anchor;
		invalidAt(
			parseCommandPayload("create", { ...createPayload(), anchor: missingPage }),
			"$.anchor.pageId",
		);
		invalidAt(parseCommandPayload("create", { ...createPayload(), actor: author }), "$.actor");
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, file: "lesson.prax" },
			}),
			"$.anchor.file",
		);
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, context: { ...anchor.context, field: "text" } },
			}),
			"$.anchor.context.field",
		);
		invalidAt(
			parseCommandPayload("create", { ...createPayload(), requestId: "not-a-uuid" }),
			"$.requestId",
		);
		invalidAt(parseCommandPayload("reply", { ...versioned(0), body: "x" }), "$.expectVersion");
		invalidAt(parseCommandPayload("reopen", { ...versioned(), body: "x" }), "$.body");
		invalidAt(parseCommandPayload("create", null), "$");
		invalidAt(
			parseCommandPayload("create", { ...createPayload(), anchor: { ...anchor, nodeId: null } }),
			"$.anchor.blockId",
		);
		invalidAt(
			parseCommandPayload("create", {
				...createPayload(),
				anchor: { ...anchor, nodeId: null, blockId: null, pin: { path: "", x: 0, y: 0 } },
			}),
			"$.anchor.pin",
		);
	});
});

describe("persisted schema admission", () => {
	it("strictly parses empty state and rejects unknown fields, missing fields and schema versions", () => {
		expect(parseReviewState(state())).toEqual({ ok: true, value: state() });
		invalidAt(parseReviewState({ ...state(), schema: 2 }), "$.schema");
		invalidAt(parseReviewState({ ...state(), unexpected: true }), "$.unexpected");
		invalidAt(
			parseReviewState({ ...state(), course: { ...state().course, extra: true } }),
			"$.course.extra",
		);
		invalidAt(
			parseReviewState({ ...state(), course: { namespace: null, bound: true } }),
			"$.course.namespace",
		);
		invalidAt(parseReviewState({ ...state(), changeSeq: 1.5 }), "$.changeSeq");
		invalidAt(parseReviewState({ ...state(), changeSeq: -1 }), "$.changeSeq");
		invalidAt(parseReviewState({ ...state(), threads: {} }), "$.threads");
	});
	it("validates nested messages, timestamps, duplicate IDs, review scope and receipt references", async () => {
		const first = await created();
		const bad = (change: (value: ReviewState) => void, path: string) => {
			const value = structuredClone(first.state);
			change(value);
			invalidAt(parseReviewState(value), path);
		};
		bad((value) => {
			value.threads[0].messages[0].body = "x".repeat(2001);
		}, "$.threads[0].messages[0].body");
		bad((value) => {
			value.threads[0].messages[0].at = "2026-02-30T12:00:00.000Z";
		}, "$.threads[0].messages[0].at");
		bad((value) => {
			Object.assign(value.threads[0].messages[0], { extra: 1 });
		}, "$.threads[0].messages[0].extra");
		bad((value) => {
			value.threads[0].reviewId = secondRequest;
		}, "$.threads[0].reviewId");
		bad((value) => {
			value.threads[0].anchor.courseId = "foreign";
		}, "$.threads[0].anchor.courseId");
		bad((value) => {
			value.threads[0].messages[0].id = threadId;
		}, "$.threads[0].messages[0].id");
		bad((value) => {
			value.threads[0].status = "resolved";
		}, "$.threads[0].resolution");
		bad((value) => {
			value.receipts[0].threadId = secondRequest;
		}, "$.receipts[0].threadId");
		bad((value) => {
			value.receipts[0].version = 2;
		}, "$.receipts[0].version");
		bad((value) => {
			value.receipts[0].messageId = secondRequest;
		}, "$.receipts[0].messageId");
		bad((value) => {
			value.receipts.push(structuredClone(value.receipts[0]));
		}, "$.receipts[1].requestId");
	});
});

describe("snapshot listing", () => {
	it("explicit undefined options use defaults while a null limit refuses", async () => {
		const data = await created();
		expect(
			await listThreads(data.state, reviewer, {
				pageId: undefined,
				status: undefined,
				cursor: undefined,
				limit: undefined,
			}),
		).toEqual({ reviewId, changeSeq: 1, threads: data.state.threads, nextCursor: null });
		invalidAt(
			await listThreads(data.state, reviewer, { limit: null } as unknown as Parameters<
				typeof listThreads
			>[2]),
			"$.limit",
		);
	});
	async function threeThreads() {
		const first = await created();
		const second = success(
			await create(
				first.state,
				reviewer,
				{ ...createPayload(), requestId: secondRequest, anchor: { ...anchor, pageId: "page-two" } },
				deps(3),
			),
		);
		return success(
			await create(
				second.state,
				reviewer,
				{ ...createPayload(), requestId: thirdRequest },
				deps(5),
			),
		);
	}
	it("returns all threads by creation order and pages a filtered snapshot", async () => {
		const data = await threeThreads();
		const all = await listThreads(data.state, reviewer);
		if ("ok" in all) throw new Error("List refused");
		expect(all).toMatchObject({ reviewId, changeSeq: 3, nextCursor: null });
		expect(all.threads.map((item) => item.id)).toEqual([
			threadId,
			"20000000-0000-4000-8000-000000000003",
			"20000000-0000-4000-8000-000000000005",
		]);
		const first = await listThreads(data.state, reviewer, {
			pageId: "page-one",
			status: "open",
			limit: 1,
		});
		if ("ok" in first || first.nextCursor === null) throw new Error("Missing page");
		expect(first.threads.map((item) => item.id)).toEqual([threadId]);
		const next = await listThreads(data.state, reviewer, {
			pageId: "page-one",
			status: "open",
			cursor: first.nextCursor,
			limit: 1,
		});
		if ("ok" in next) throw new Error("List refused");
		expect(next.threads.map((item) => item.id)).toEqual(["20000000-0000-4000-8000-000000000005"]);
		expect(next.nextCursor).toBeNull();
		all.threads[0].messages[0].body = "Changed list";
		expect(data.state.threads[0].messages[0].body).toBe("Please change this.");
	});
	it("applies visibility before page lengths and cursors while the default shows every thread", async () => {
		const data = await threeThreads();
		const hidden = "20000000-0000-4000-8000-000000000003";
		const policy: ReviewVisibilityPolicy = {
			visibleTo: (principal, thread, current) =>
				principal.role === "author" || (current.reviewId === reviewId && thread.id !== hidden),
		};
		const all = await listThreads(data.state, reviewer, {}, reviewVisibility);
		if ("ok" in all) throw new Error("List refused");
		expect(all.threads.map((thread) => thread.id)).toEqual([
			threadId,
			hidden,
			"20000000-0000-4000-8000-000000000005",
		]);
		const first = await listThreads(data.state, reviewer, { limit: 1 }, policy);
		if ("ok" in first || first.nextCursor === null) throw new Error("Missing visible page");
		expect(first.threads.map((thread) => thread.id)).toEqual([threadId]);
		const next = await listThreads(
			data.state,
			reviewer,
			{ limit: 1, cursor: first.nextCursor },
			policy,
		);
		if ("ok" in next) throw new Error("List refused");
		expect(next.threads.map((thread) => thread.id)).toEqual([
			"20000000-0000-4000-8000-000000000005",
		]);
		expect(next.nextCursor).toBeNull();
		const page = await listThreads(data.state, reviewer, { limit: 2 }, policy);
		if ("ok" in page) throw new Error("List refused");
		expect(page.threads).toHaveLength(2);
		expect(page.nextCursor).toBeNull();
		expect(await listThreads(data.state, reviewer, { pageId: "page-two" }, policy)).toEqual({
			reviewId,
			changeSeq: 3,
			threads: [],
			nextCursor: null,
		});
		const authorView = await listThreads(data.state, author, {}, policy);
		if ("ok" in authorView) throw new Error("List refused");
		expect(authorView.threads).toHaveLength(3);
	});
	it("refuses invalid read principals through the contract", async () => {
		const data = await created();
		invalidAt(
			await listThreads(data.state, { ...reviewer, role: "learner" } as unknown as ReviewPrincipal),
			"$.role",
		);
	});
	it("refuses snapshot drift and cursors for different filters or reviews", async () => {
		const data = await threeThreads();
		const first = await listThreads(data.state, reviewer, { limit: 1 });
		if ("ok" in first || first.nextCursor === null) throw new Error("Missing page");
		const changed = success(
			await reply(data.state, author, { ...versioned(1, fourthRequest), body: "Update" }, deps(7)),
		);
		expect(
			await listThreads(changed.state, reviewer, { cursor: first.nextCursor, limit: 1 }),
		).toEqual({
			ok: false,
			code: "snapshot_changed",
			detail: {},
		});
		expect(
			await listThreads(data.state, reviewer, {
				cursor: first.nextCursor,
				pageId: "page-one",
				limit: 1,
			}),
		).toEqual({ ok: false, code: "invalid_cursor", detail: {} });
		expect(
			await listThreads({ ...data.state, reviewId: secondRequest }, reviewer, {
				cursor: first.nextCursor,
			}),
		).toEqual({ ok: false, code: "invalid_cursor", detail: {} });
		expect(await listThreads(data.state, reviewer, { cursor: "bad%" })).toEqual({
			ok: false,
			code: "invalid_cursor",
			detail: {},
		});
	});
	it("bounds limits and cursor length and returns empty filtered lists", async () => {
		const data = await created();
		expect("ok" in (await listThreads(data.state, reviewer, { limit: 100 }))).toBe(false);
		for (const limit of [0, -1, 101, 1.5, Number.NaN])
			invalidAt(await listThreads(data.state, reviewer, { limit }), "$.limit");
		expect(await listThreads(data.state, reviewer, { cursor: "x".repeat(2048) })).toEqual({
			ok: false,
			code: "invalid_cursor",
			detail: {},
		});
		invalidAt(await listThreads(data.state, reviewer, { cursor: "x".repeat(2049) }), "$.cursor");
		expect(await listThreads(data.state, reviewer, { status: "resolved" })).toEqual({
			reviewId,
			changeSeq: 1,
			threads: [],
			nextCursor: null,
		});
	});
	it("binds cursors to principal ID, role and exact visible membership", async () => {
		const data = await threeThreads();
		const all = await listThreads(data.state, reviewer, { limit: 1 });
		if ("ok" in all || !all.nextCursor) throw new Error("Missing cursor");
		for (const principal of [
			{ ...reviewer, id: "different-principal" },
			{ ...reviewer, role: "author" as const },
		])
			expect(await listThreads(data.state, principal, { cursor: all.nextCursor })).toEqual({
				ok: false,
				code: "invalid_cursor",
				detail: {},
			});
		const changed = success(
			await reply(data.state, author, { ...versioned(1, fourthRequest), body: "Update" }, deps(7)),
		);
		expect(await listThreads(changed.state, author, { cursor: all.nextCursor })).toEqual({
			ok: false,
			code: "invalid_cursor",
			detail: {},
		});
		const firstPolicy: ReviewVisibilityPolicy = {
			visibleTo: (_principal, thread) => thread.id !== data.state.threads[0].id,
		};
		const secondPolicy: ReviewVisibilityPolicy = {
			visibleTo: (_principal, thread) => thread.id !== data.state.threads[1].id,
		};
		const page = await listThreads(data.state, reviewer, { limit: 1 }, firstPolicy);
		if ("ok" in page || !page.nextCursor) throw new Error("Missing cursor");
		// Same number visible, different membership: offsets cannot be shared.
		expect(
			await listThreads(data.state, reviewer, { cursor: page.nextCursor }, secondPolicy),
		).toEqual({ ok: false, code: "invalid_cursor", detail: {} });
		const unchanged = await listThreads(
			data.state,
			reviewer,
			{ cursor: page.nextCursor },
			{ visibleTo: firstPolicy.visibleTo },
		);
		if ("ok" in unchanged) throw new Error("Equivalent policy refused");
		expect(unchanged.threads.map((thread) => thread.id)).toEqual([data.state.threads[2].id]);
	});
});

it("parses principals strictly through the public contract before policies use them", () => {
	expect(parseReviewPrincipal(reviewer)).toEqual({ ok: true, value: reviewer });
	for (const [raw, path] of [
		[null, "$"],
		[{ ...reviewer, role: "learner" }, "$.role"],
		[{ ...reviewer, extra: true }, "$.extra"],
	])
		expect(parseReviewPrincipal(raw)).toMatchObject({
			ok: false,
			code: "invalid_input",
			detail: { path },
		});
});
