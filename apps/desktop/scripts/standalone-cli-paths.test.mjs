import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNoPrivateCheckoutPath, portablePath } from "./standalone-cli-paths.mjs";

test("Windows schema paths retain the schema asset prefix", () => {
	for (const pathApi of [path.posix, path.win32]) {
		const pipeline = pathApi.resolve("export-pipeline");
		const file = pathApi.join(pipeline, "schemas", "SCORM_2004", "imscp_v1p1.xsd");
		const relative = portablePath(pathApi.relative(pipeline, file));
		assert.equal(relative, "schemas/SCORM_2004/imscp_v1p1.xsd");
		assert.ok(relative.startsWith("schemas/"));
	}
});

test("privacy scan rejects checkout and home paths while accepting binary null bytes", () => {
	for (const repoDir of [path.resolve("private-checkout"), "C:\\private\\checkout"]) {
		for (const privatePath of [repoDir, portablePath(repoDir)]) {
			assert.throws(
				() => assertNoPrivateCheckoutPath(Buffer.from(privatePath), "praxity.mjs", repoDir),
				/Private checkout path/,
			);
		}
	}
	const repoDir = path.resolve("private-checkout");
	const homeDir = process.env.HOME || homedir();
	for (const privatePath of [homeDir, portablePath(homeDir)]) {
		assert.throws(
			() => assertNoPrivateCheckoutPath(Buffer.from(privatePath), "font", repoDir),
			/Private checkout path/,
		);
	}
	assertNoPrivateCheckoutPath(Buffer.from([0, 1, 2, 0]), "font", repoDir);
});

test("privacy scan uses the real home directory when HOME is unset", () => {
	const env = { ...process.env };
	delete env.HOME;
	const helper = new URL("./standalone-cli-paths.mjs", import.meta.url).href;
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import assert from "node:assert/strict";
			import { homedir } from "node:os";
			import { assertNoPrivateCheckoutPath } from ${JSON.stringify(helper)};
			assertNoPrivateCheckoutPath(Buffer.from([0, 1, 0]), "font", "private-checkout");
			assert.throws(
				() => assertNoPrivateCheckoutPath(Buffer.from(homedir()), "font", "private-checkout"),
				/Private checkout path/,
			);`,
		],
		{ env, encoding: "utf8", timeout: 10_000 },
	);
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
});

// Supply verified upstream binaries for the positive checks; never commit release binaries.
for (const target of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
	test(`privacy scan admits only the exact upstream Typst ${target} bytes at typst/typst`, {
		skip: !process.env.TYPST_PATH_SCAN_FIXTURES,
	}, async () => {
		const bytes = await readFile(
			path.join(process.env.TYPST_PATH_SCAN_FIXTURES, `${target}-typst`),
		);
		const repoDir = "/Users/runner/work/studio/studio";
		// Use the matching prefix as the checkout too, so this runs on every host.
		const upstreamHome = "/Users/runner";
		assert.ok(bytes.includes(Buffer.from(upstreamHome)));
		assert.doesNotThrow(() => assertNoPrivateCheckoutPath(bytes, "typst/typst", upstreamHome));
		for (const relative of ["other/typst", "typst/other", "typst/typst.exe", "praxity.mjs"]) {
			assert.throws(
				() => assertNoPrivateCheckoutPath(bytes, relative, upstreamHome),
				/Private checkout path/,
			);
		}
		for (const altered of [
			Buffer.concat([bytes, Buffer.from("modified")]),
			Buffer.from(upstreamHome),
		]) {
			assert.throws(
				() => assertNoPrivateCheckoutPath(altered, "typst/typst", upstreamHome),
				/Private checkout path/,
			);
		}
		assert.throws(
			() => assertNoPrivateCheckoutPath(Buffer.from(repoDir), "praxity.mjs", repoDir),
			/Private checkout path/,
		);
	});
}

test("privacy scan rejects unrecognized Typst bytes and Studio JavaScript containing checkout paths", () => {
	const repoDir = path.resolve("private-checkout");
	for (const relative of ["typst/typst", "other/typst", "praxity.mjs"]) {
		assert.throws(
			() => assertNoPrivateCheckoutPath(Buffer.from(repoDir), relative, repoDir),
			/Private checkout path/,
		);
	}
});
