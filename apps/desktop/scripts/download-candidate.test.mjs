import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { downloadCandidate } from "./download-candidate.mjs";

for (const scenario of [
	"ok",
	"native arm64",
	"native x64",
	"tampered",
	"wrong ID",
	"duplicate",
	"missing",
	"wrong name",
	"bad digest",
	"network failure",
])
	test(`candidate download by release ID: ${scenario}`, (t) => {
		const directory = mkdtempSync(join(tmpdir(), "candidate-download-"));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const outputDir = join(directory, "download");
		const names = {
			arm64: "praxity-cli-0.3.0-macos-arm64.tar.gz",
			x64: "praxity-cli-0.3.0-macos-x64.tar.gz",
		};
		const digests = Object.fromEntries(
			["arm64", "x64"].map((arch) => [arch, createHash("sha256").update(arch).digest("hex")]),
		);
		if (scenario === "bad digest") digests.arm64 = "bad";
		const calls = [];
		const execute = (command, args) => {
			assert.equal(command, "gh");
			calls.push(args);
			const route = args.at(-1);
			if (scenario === "network failure") throw new Error("offline");
			if (route.endsWith("/releases/42/assets?per_page=100")) {
				let assets = [
					{ id: 77, name: names.arm64 },
					{ id: 78, name: names.x64 },
					{ id: 79, name: `${names.arm64}.sha256` },
				];
				if (scenario === "duplicate") assets.push(assets[0]);
				if (scenario === "missing") assets = assets.slice(1);
				if (scenario === "wrong name") assets[0].name = "../archive.tar.gz";
				if (scenario === "wrong ID") assets[0].id = "77";
				return JSON.stringify([assets]);
			}
			assert.ok(args.includes("Accept: application/octet-stream"));
			if (route.endsWith("/releases/assets/77"))
				return Buffer.from(scenario === "tampered" ? "replaced bytes" : "arm64");
			if (route.endsWith("/releases/assets/78")) return Buffer.from("x64");
			throw new Error(`Unexpected route ${route}`);
		};
		const arch = scenario.startsWith("native ") ? scenario.split(" ")[1] : undefined;
		const run = () =>
			downloadCandidate(
				{ releaseId: "42", repository: "owner/private", outputDir, names, digests, arch },
				execute,
			);
		if (scenario === "ok" || arch) {
			run();
			for (const selected of arch ? [arch] : ["arm64", "x64"])
				assert.equal(readFileSync(join(outputDir, names[selected]), "utf8"), selected);
			assert.equal(calls.length, arch ? 2 : 3);
		} else assert.throws(run, /digest|asset|offline/);
		assert.doesNotMatch(JSON.stringify(calls), /releases\/tags|release.*download/);
	});

test("candidate download refuses a non-ID before requesting GitHub", () => {
	assert.throws(
		() => downloadCandidate({ releaseId: "cli-candidate-42" }, () => assert.fail("No API")),
		/release ID/,
	);
});

for (const [arch, name] of [
	["arm64", "../archive.tar.gz"],
	["riscv64", "praxity-cli-0.3.0-macos-riscv64.tar.gz"],
])
	test(`candidate refuses invalid expected ${arch} name before requesting GitHub`, () => {
		assert.throws(
			() =>
				downloadCandidate(
					{ releaseId: "42", arch, names: { [arch]: name }, digests: { [arch]: "a".repeat(64) } },
					() => assert.fail("No API"),
				),
			/asset name|build digest/,
		);
	});
