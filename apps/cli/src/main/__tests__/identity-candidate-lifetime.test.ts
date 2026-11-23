import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	persistCourseIdentity,
	planReadIdentity,
	type ResolvedCourseIdentity,
	readCourseIdentity,
	resolveCourseIdentity,
	resolveReadOperation,
} from "../identity-store";
import * as pathSecurity from "../path-security";
import { withProjectFileTransaction } from "../project-file-transactions";

const roots: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("I4 an in-flight persistence cannot carry a candidate beyond its write admission", async () => {
	const root = await fixture();
	let signalReached!: () => void;
	let signalRelease!: () => void;
	const reached = new Promise<void>((resolve) => {
		signalReached = resolve;
	});
	const release = new Promise<void>((resolve) => {
		signalRelease = resolve;
	});
	const resolvePath = pathSecurity.resolveWritablePathWithin;
	vi.spyOn(pathSecurity, "resolveWritablePathWithin").mockImplementation(
		async (admitted, target) => {
			const path = await resolvePath(admitted, target);
			if (target === join(admitted, "metadata.json")) {
				signalReached();
				await release;
			}
			return path;
		},
	);
	let saving: Promise<ResolvedCourseIdentity> | undefined;
	try {
		await withProjectFileTransaction(
			root,
			async (admitted) => {
				const candidate = await resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] });
				saving = persistCourseIdentity(admitted, candidate, [
					{ path: "metadata.json", content: "{}" },
				]);
				await reached;
			},
			"write",
		);
	} finally {
		signalRelease();
	}
	if (!saving) throw new Error("Missing persistence");
	await expect(saving).rejects.toThrow("Identity: write candidate admission expired");
	expect((await readdir(root)).sort()).toEqual(["a.prax"]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "identity-lifetime-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "# P\n\nText\n");
	return root;
}

it("I4 a candidate cannot authorize persistence in a later write transaction", async () => {
	const root = await fixture();
	const candidate = await withProjectFileTransaction(
		root,
		(admitted) => resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] }),
		"write",
	);
	const before = await readdir(root);
	await expect(
		withProjectFileTransaction(
			root,
			(admitted) => persistCourseIdentity(admitted, candidate),
			"write",
		),
	).rejects.toThrow("Identity: write candidate admission expired");
	expect(await readdir(root)).toEqual(before);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
});

it("I4 a failed write revokes its candidate before another admission can use it", async () => {
	const root = await fixture();
	let candidate: ResolvedCourseIdentity | undefined;
	await expect(
		withProjectFileTransaction(
			root,
			async (admitted) => {
				candidate = await resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] });
				throw new Error("deliberate write refusal");
			},
			"write",
		),
	).rejects.toThrow("deliberate write refusal");
	if (!candidate) throw new Error("Missing candidate");
	const expired = candidate;
	await expect(
		withProjectFileTransaction(
			root,
			(admitted) => persistCourseIdentity(admitted, expired),
			"write",
		),
	).rejects.toThrow("Identity: write candidate admission expired");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
});

it("I4 every reader-reachable identity of an unstored course is a runtime token", async () => {
	const root = await fixture();
	const reader = await readCourseIdentity(root, { lessonPaths: ["a.prax"] });
	const strings: string[] = [];
	const visited = new Set<unknown>();
	function visit(value: unknown): void {
		if (typeof value === "string") {
			strings.push(value);
			return;
		}
		if (!value || typeof value !== "object" || visited.has(value)) return;
		visited.add(value);
		if (value instanceof Map) {
			for (const [key, item] of value) {
				visit(key);
				visit(item);
			}
		} else
			for (const [key, item] of Object.entries(value)) {
				visit(key);
				visit(item);
			}
	}
	visit(reader);
	expect(
		strings.filter((value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)),
	).toEqual([]);
	for (const [file, lesson] of reader.lessons) {
		for (const [id, record] of lesson.nodes) {
			expect(id).toMatch(/^rt-[0-9a-f]{32}$/);
			expect(reader.ids.get(file)?.(record.node, record.role)).toBe(id);
		}
	}
	await expect(
		withProjectFileTransaction(
			root,
			(admitted) => persistCourseIdentity(admitted, reader),
			"write",
		),
	).rejects.toThrow("Identity: resolution was changed or was not issued by this store");
});

it("I4 a candidate cannot authorize an operation base in a later write transaction", async () => {
	const root = await fixture();
	const candidate = await withProjectFileTransaction(
		root,
		(admitted) => resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] }),
		"write",
	);
	await expect(
		withProjectFileTransaction(
			root,
			(admitted) =>
				resolveCourseIdentity(admitted, {
					lessonPaths: ["a.prax"],
					operationBase: candidate,
					operations: [{ intent: "modify", files: [], mapping: [], placements: [] }],
				}),
			"write",
		),
	).rejects.toThrow("Identity: write candidate admission expired");
});

for (const [name, read] of [
	["read planning", planReadIdentity],
	["dry-run", resolveReadOperation],
] as const) {
	it(`I4 ${name} refuses a candidate after its write admission closes`, async () => {
		const root = await fixture();
		const { candidate, request } = await withProjectFileTransaction(
			root,
			async (admitted) => {
				const candidate = await resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] });
				const target = candidate.identity.sourceMappings.find(
					(mapping) => mapping.file === "a.prax" && mapping.path.join() === "0,0",
				);
				if (!target) throw new Error("Missing paragraph");
				const request: Parameters<typeof resolveReadOperation>[1] = {
					transactionId: "expired-read-candidate",
					operation: "editSource",
					files: [
						{
							path: "a.prax",
							baseRevision: createHash("sha256").update("# P\n\nText\n").digest("hex"),
						},
					],
					targets: [
						{
							file: "a.prax",
							ref: {
								kind: "node",
								nodeId: target.id,
								path: target.path,
								fingerprint: target.fingerprint,
							},
							expectedText: "Text\n",
						},
					],
					args: { text: "Changed\n" },
				};
				expect(read(candidate, request).ok).toBe(true);
				return { candidate, request };
			},
			"write",
		);
		expect(() => read(candidate, request)).toThrow("Identity: write candidate admission expired");
		expect((await readdir(root)).sort()).toEqual(["a.prax"]);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
	});
}

it("I4 a nested write preserves candidate issuance until its owning transaction closes", async () => {
	const root = await fixture();
	const durable = await withProjectFileTransaction(
		root,
		async (admitted) => {
			const candidate = await resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] });
			return withProjectFileTransaction(
				admitted,
				(same) => persistCourseIdentity(same, candidate),
				"write",
			);
		},
		"write",
	);
	expect(durable.transientIds).toBe(false);
	expect(await readFile(join(root, ".praxity/identity/course.json"), "utf8")).toContain(
		durable.identity.course.courseId,
	);
});
