import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createStudioProjectSession } from "../studio/project-session";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

for (const attempts of ["2.5", "'2'", "2"]) {
	test(`Studio opens a project whose choice has attempts=${attempts}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "review-opus-open-"));
		roots.push(root);
		await writeFile(
			join(root, "lesson.prax"),
			`# Page\n\n::: choice Pick one {attempts=${attempts}}\n(x) Yes\n( ) No\n:::\n`,
		);
		await writeFile(join(root, "course.yaml"), "title: Fresh\nlessons: [lesson.prax]\n");
		let session: Awaited<ReturnType<typeof createStudioProjectSession>> | undefined;
		let failure: unknown;
		try {
			session = await createStudioProjectSession(root, "test");
		} catch (error) {
			failure = error;
		} finally {
			await session?.close();
		}
		expect(failure).toBeUndefined();
	});
}
