import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

test("real source-owner command guards pattern renderers and enhancer entries", () => {
	const root = mkdtempSync(join(tmpdir(), "pattern-owners-"));
	const check = () =>
		spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
	const write = (path, source) => {
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, source);
	};
	try {
		execFileSync("git", ["init", "--quiet", root]);
		write(
			"packages/export-pipeline/src/patterns/text/render.ts",
			'import type { PraxityBlock } from "@praxity/content-model"; import { sanitizeHtml } from "@praxity/shared-blocks/sanitize"; export const render = (block: PraxityBlock) => sanitizeHtml(block.data.text);',
		);
		const clean = check();
		assert.equal(clean.status, 0, clean.stderr);
		assert.match(clean.stdout, /Source ownership checks passed/);
		const plants = [
			[
				"content-import.ts",
				'import { readSelfCheckContent } from "@praxity/grammar";',
				/declared author owner/,
			],
			[
				"content-access.ts",
				"const content = block.data.selfCheckContent;",
				/declared author owner/,
			],
			["write.ts", 'writeLearnerBlockState("check", {});', /captured ticket variable or parameter/],
			[
				"enhance.tsx",
				'document.dispatchEvent(new CustomEvent("praxity:assessment-response"));',
				/dispatchSelfCheckEvent with captured authority/,
			],
			["host.ts", "window.__praxityRuntime.complete();", /learner host access requires/],
			["defer.ts", "new ResizeObserver(() => {});", /lifetime helpers/],
		];
		for (const [name, source, rule] of plants) {
			const path = `packages/export-pipeline/src/patterns/self-check/${name}`;
			write(path, source);
			const result = check();
			assert.equal(result.status, 1, `${path}: ${result.stdout}`);
			assert.ok(
				result.stderr.split("\n").some((line) => line.startsWith(`${path}:1:`) && rule.test(line)),
				result.stderr,
			);
			rmSync(join(root, path));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// Each plant runs the real command in an isolated repository, including its TS program.
for (const [name, files, rule] of [
	...["fixtures", "tests", "test-utils", "__tests__", "e2e"].map((directory) => [
		`code under ${directory} retains ownership checks`,
		{ [`src/patterns/self-check/${directory}/enhance.ts`]: "window.__praxityRuntime.complete();" },
		/learner host access requires/,
	]),
	[
		"fixture Content access",
		{ "src/patterns/self-check/fixtures/content.ts": "block.data.selfCheckContent;" },
		/declared author owner/,
	],
	[
		"fixture learner write",
		{ "src/patterns/self-check/fixtures/write.ts": 'writeLearnerBlockState("check", {});' },
		/captured ticket variable/,
	],
	[
		"fixture raw event",
		{
			"src/patterns/self-check/fixtures/event.ts":
				'document.dispatchEvent(new CustomEvent("praxity:assessment-response"));',
		},
		/dispatchSelfCheckEvent|write-capable learner event/,
	],
	[
		"fixture scheduler",
		{ "src/patterns/self-check/fixtures/timer.ts": "setTimeout(() => {}, 0);" },
		/lifetime helpers/,
	],
	[
		"fixture source detection",
		{ "src/patterns/self-check/fixtures/source.ts": 'text.startsWith("---");' },
		/source detection belongs/,
	],
	[
		"fixture typed provider write",
		{
			"../shared-blocks/src/learner-block-state.ts":
				"export interface Provider { set(key: string, value: unknown): void; }",
			"src/patterns/self-check/fixtures/provider.ts":
				'import type { Provider } from "../../../../../shared-blocks/src/learner-block-state"; declare const provider: Provider; provider.set("x", {});',
		},
		/learner provider writes require/,
	],
	[
		"exported event constant",
		{ "src/patterns/self-check/events.ts": 'export const E = "praxity:assessment-response";' },
		/write-capable learner event/,
	],
	[
		"concatenated event constant",
		{ "src/patterns/self-check/events.ts": 'export const E = "praxity:" + "assessment-response";' },
		/write-capable learner event/,
	],
	[
		"imported event name",
		{
			"src/patterns/self-check/enhance.ts":
				'import { E } from "../../events"; document.dispatchEvent(new CustomEvent(E));',
			"src/events.ts": 'export const E = "praxity:assessment-response";',
		},
		/unresolved learner event name/,
	],
	[
		"unresolved dynamic event",
		{ "src/patterns/self-check/enhance.ts": "document.dispatchEvent(new CustomEvent(eventName));" },
		/unresolved learner event name/,
	],
	[
		"concatenated Content access",
		{ "src/patterns/self-check/render.ts": 'block.data["selfCheck" + "Content"];' },
		/declared author owner/,
	],
	[
		"exported Content key",
		{ "src/patterns/self-check/keys.ts": 'export const key = "selfCheck" + "Content";' },
		/declared author owner/,
	],
	[
		"template pattern scheduler",
		{ "template/src/patterns/self-check/enhance.ts": "setTimeout(() => {}, 0);" },
		/lifetime helpers/,
	],
	[
		"R2-P2 imported Content key",
		{
			"src/keys.ts": 'export const K = "selfCheckContent";',
			"src/patterns/self-check/render.ts": 'import { K } from "../../keys"; block.data[K];',
		},
		/declared author owner/,
	],
	[
		"R2-P2 computed Content destructuring",
		{
			"src/keys.ts": 'export const K = "selfCheckContent";',
			"src/patterns/self-check/render.ts":
				'import { K } from "../../keys"; const { [K]: content } = block.data;',
		},
		/declared author owner/,
	],
	[
		"R2-P2 template Content key",
		{
			"src/patterns/self-check/render.ts":
				'const part = "Content"; block.data[`selfCheck${part}`];',
		},
		/declared author owner/,
	],
	...["block.data[key];", "const { [key]: content } = block.data;"].map((access, index) => [
		`R2-P2 unresolved computed block data ${index === 0 ? "access" : "destructuring"}`,
		{
			"src/patterns/self-check/render.ts": `declare const key: string; ${access}`,
		},
		/unresolved computed block data key/,
	]),
	[
		"R2-P3a Reflect event construction",
		{
			"src/events.ts": 'export const E = "praxity:assessment-response";',
			"src/patterns/self-check/enhance.ts":
				'import { E } from "../../events"; const ev = Reflect.construct(CustomEvent, [E]);',
		},
		/Reflect.construct.*event constructors/,
	],
	...["call", "apply", "bind"].map((method) => [
		`R2-P3a indirect dispatch ${method}`,
		{
			"src/patterns/self-check/enhance.ts": `declare const ev: Event; el.dispatchEvent.${method}(el, ${method === "apply" ? "[ev]" : "ev"});`,
		},
		/unresolved learner event name/,
	]),
	[
		"R2-P3a Reflect construction and call dispatch escape",
		{
			"src/events.ts": 'export const E = "praxity:assessment-response";',
			"src/patterns/self-check/enhance.ts":
				'import { E } from "../../events"; const ev = Reflect.construct(CustomEvent, [E]); el.dispatchEvent.call(el, ev);',
		},
		/Reflect.construct.*event constructors|unresolved learner event name/,
	],
	[
		"R2-P3b identifier learner event remains refused",
		{
			"src/patterns/self-check/enhance.ts":
				'const e = new CustomEvent("praxity:assessment-response"); input.dispatchEvent(e);',
		},
		/write-capable learner event|dispatchSelfCheckEvent/,
	],
]) {
	test(`pattern plant: ${name}`, () => {
		const root = mkdtempSync(join(tmpdir(), "pattern-plant-"));
		try {
			execFileSync("git", ["init", "--quiet", root]);
			for (const [path, source] of Object.entries(files)) {
				const target = join(root, "packages/export-pipeline", path);
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, source);
			}
			const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
				cwd: root,
				encoding: "utf8",
			});
			assert.equal(result.status, 1, `${name}: ${result.stdout}${result.stderr}`);
			assert.ok(
				result.stderr
					.split("\n")
					.some((line) => line.startsWith("packages/export-pipeline/") && rule.test(line)),
				result.stderr,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("pattern literal fixtures and UI events pass; existing islands retain string behavior", () => {
	const root = mkdtempSync(join(tmpdir(), "pattern-compatible-"));
	const files = {
		"packages/export-pipeline/src/patterns/text/fixtures/literal.json":
			'{"selfCheckContent":"praxity:assessment-response"}',
		"packages/export-pipeline/src/patterns/text/fixtures/literal.prax":
			"selfCheckContent praxity:assessment-response",
		"packages/export-pipeline/src/patterns/text/fixtures/render.ts":
			'const key = "text"; export const render = () => block.data[key] + block.data[`te${"xt"}`]; const { [key]: text } = block.data; declare const index: string; labels[index];',
		"packages/export-pipeline/src/patterns/text/enhance.ts":
			'document.dispatchEvent(new CustomEvent("praxity:visibility-change"));',
		"packages/export-pipeline/template/src/islands/events.ts":
			'export const E = "praxity:assessment-response"; block.data["selfCheck" + "Content"];',
		"packages/export-pipeline/template/src/islands/future.ts":
			'import { E } from "./events"; document.dispatchEvent(new CustomEvent(E)); declare const key: string; block.data[key]; const { [key]: content } = block.data; const ev = Reflect.construct(CustomEvent, [E]); el.dispatchEvent.call(el, ev);',
	};
	try {
		execFileSync("git", ["init", "--quiet", root]);
		for (const [path, source] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), source);
		}
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("R2-P3b same-file identifier UI events pass in both pattern roots", () => {
	const root = mkdtempSync(join(tmpdir(), "pattern-ui-event-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		for (const prefix of ["src", "template/src"]) {
			const target = join(root, "packages/export-pipeline", prefix, "patterns/text/enhance.ts");
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(
				target,
				'export {}; const e = new Event("change"); input.dispatchEvent(e); const visible = new CustomEvent("praxity:visibility-change"); input.dispatchEvent(visible);',
			);
		}
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
