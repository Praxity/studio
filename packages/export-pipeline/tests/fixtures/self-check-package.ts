import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import type { SelfCheckContentInput } from "../../src/build";

/** Positive package contract, alongside the output invariant's spoiler scan. */
export function assertSelfCheckPackage(zip: AdmZip, expected: readonly SelfCheckContentInput[]) {
	const assets = zip
		.getEntries()
		.filter((entry) => !entry.isDirectory && entry.entryName.startsWith("self-check/"));
	assert.equal(assets.length, expected.length, "Complete per-activity asset inventory");
	const references = new Map<string, { path: string; revision: string }>();
	for (const entry of zip.getEntries().filter((entry) => entry.entryName.endsWith(".html"))) {
		const dom = new JSDOM(entry.getData().toString());
		try {
			for (const root of dom.window.document.querySelectorAll<HTMLElement>("[data-self-check]")) {
				const id = root.dataset.selfCheckId;
				assert.ok(id);
				const reference = {
					path: root.dataset.selfCheckSrc ?? "",
					revision: root.dataset.selfCheckRevision ?? "",
				};
				if (references.has(id)) assert.deepEqual(reference, references.get(id));
				references.set(id, reference);
			}
		} finally {
			dom.window.close();
		}
	}
	assert.deepEqual([...references.keys()].sort(), expected.map((input) => input.blockId).sort());
	for (const input of expected) {
		const reference = references.get(input.blockId);
		assert.ok(reference);
		const asset = zip.getEntry(reference.path);
		assert.ok(asset, `Missing packaged activity ${input.blockId}`);
		const bytes = asset.getData();
		assert.equal(
			reference.path,
			`self-check/${createHash("sha256").update(bytes).digest("hex")}.js`,
		);
		assert.equal(reference.revision, input.contentRevision);
		const payload = bytes
			.toString()
			.match(/^globalThis\.__praxitySelfCheckAsset\?\.\((.*)\);\n$/u)?.[1];
		assert.ok(payload, "Executable activity payload");
		assert.deepEqual(JSON.parse(payload), input, "Complete authored activity content");
	}
}
