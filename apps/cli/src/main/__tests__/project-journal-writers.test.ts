import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { NARRATION_METADATA_VERSION, NARRATION_RECIPE, SONIOX_MODEL } from "../../shared/narration";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { withProjectFileTransaction } from "../project-file-transactions";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
for (const action of ["manifest", "delete", "rename", "create", "narration"]) {
	it(`T1 recovers the complete authored ${action} plan after actual process death`, async () => {
		const root = await mkdtemp(join(tmpdir(), "journal-writers-"));
		roots.push(root);
		await writeFile(join(root, "lesson.prax"), "# Authored\r\nWords.\n");
		const manifest = "# Preserve\r\ntitle: Authored\nlessons: [lesson.prax]\r\n";
		await writeFile(join(root, "course.yaml"), manifest);
		await persistFixtureIdentity(root);
		const source = await readFile(join(root, "lesson.prax"));
		const identity = await readIdentityFixture(root);
		if (action === "narration") {
			await mkdir(join(root, "assets"));
			const scriptHash = "a".repeat(64),
				lexiconHash = "b".repeat(64);
			const vtt = `WEBVTT\n\nNOTE praxity-narration\nprovider=soniox\nmodel=${SONIOX_MODEL}\nlanguage=en\nvoice=Maya\nspeed=1\nscriptHash=${scriptHash}\nlexiconHash=${lexiconHash}\nrecipeHash=${createHash("sha256").update(NARRATION_RECIPE).digest("hex")}\nversion=${NARRATION_METADATA_VERSION}\n`;
			await writeFile(
				join(root, "generated.json"),
				JSON.stringify({
					request: {
						requestId: "test",
						originalScript: "Hi.",
						language: "en",
						voice: "Maya",
						speed: 1,
						lexemes: [],
						segmentId: "test",
					},
					generated: { vtt, scriptHash, lexiconHash, durationSeconds: 1 },
				}),
			);
		}
		const child = fork(
			fileURLToPath(new URL("./fixtures/authored-writer.ts", import.meta.url)),
			[root, action],
			{
				execArgv: ["--import", "tsx"],
				stdio: ["ignore", "ignore", "pipe", "ipc"],
			},
		);
		const exited = once(child, "exit");
		try {
			const [message] = await once(child, "message");
			expect(message).toEqual({ paused: true });
		} finally {
			child.kill("SIGKILL");
			await exited;
		}
		await withProjectFileTransaction(root, async () => {}, "write");
		expect(await readFile(join(root, "lesson.prax"))).toEqual(source);
		expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(manifest);
		expect((await readIdentityFixture(root)).files).toEqual(identity.files);
		await expect(readFile(join(root, "renamed.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(join(root, "new.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		if (action === "narration")
			expect(await readdir(join(root, "assets", "narration"))).toEqual([]);
	});
}
