import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEditorSource } from "./check-editor-ownership.mjs";

const trustPaths = [
	"packages/editor-core/src/frame-bridge/planted.ts",
	"packages/editor-core/src/shortcuts/planted.ts",
	"packages/editor-core/src/session/planted.ts",
];
test("T1 rejects planted input and message listeners in every retained editor directory", () => {
	for (const path of trustPaths)
		for (const event of [
			"keydown",
			"keyup",
			"keypress",
			"click",
			"dblclick",
			"auxclick",
			"contextmenu",
			"wheel",
			"mousedown",
			"touchstart",
			"dragstart",
			"drop",
			"gotpointercapture",
			"lostpointercapture",
			"pointerdown",
			"pointerover",
			"focus",
			"focusin",
			"focusout",
			"blur",
			"message",
			"cancel",
		])
			for (const source of [
				`doc.addEventListener('${event}', handle);`,
				`doc['addEventListener'](\`${event}\`, handle, true);`,
				`const kind = '${event}'; doc.addEventListener(kind, handle);`,
			])
				assert.match(checkEditorSource(path, source).join("\n"), /T1:/, `${path}: ${source}`);
	for (const source of [
		"win.onmessage = receive",
		"port['onmessage'] = receive",
		"node.onpointerdown = receive",
		"node.onfocusin = receive",
		"const listen = doc.addEventListener; listen('keydown', handle)",
		"doc.addEventListener(eventName, handle)",
		"let kind = 'resize'; kind = 'keydown'; doc.addEventListener(kind, handle)",
		"const { addEventListener: listen } = doc; listen('keydown', handle)",
	])
		assert.match(checkEditorSource(trustPaths[0], source).join("\n"), /T1:/, source);
	assert.deepEqual(
		checkEditorSource(trustPaths[0], "win.addEventListener('resize', schedule)"),
		[],
	);
	assert.deepEqual(
		checkEditorSource(
			"packages/editor-core/src/frame-bridge/listeners.ts",
			"doc.addEventListener('keydown', handle)",
		),
		[],
	);
	assert.deepEqual(
		checkEditorSource(
			"apps/desktop/src/renderer/EditorView.tsx",
			"doc.addEventListener('keydown', handle)",
		),
		[],
	);
});

test("T2 rejects planted trust-marker reads and writes outside the WeakSet owner", () => {
	for (const path of trustPaths)
		for (const source of [
			"node.getAttribute('data-praxity-chrome')",
			"node.getAttribute('DATA-PRAXITY-CHROME')",
			"node.querySelector('[DATA-NODE-ID]')",
			"node['getAttribute']('data-focus-role')",
			"const selector = '[data-node-id]'; doc.querySelectorAll(selector)",
			"doc.querySelector(`[data-praxity-selected]`)",
			"node.closest('[data-focus-role]')",
			"node.dataset.praxityChrome",
			"node.dataset.nodeId = id",
			"node['dataset']['focusRole']",
			"const { nodeId } = node.dataset",
			"const markers = node.dataset; markers.praxityChrome",
			"const { dataset: markers } = node; markers.nodeId",
			"let key = 'aria-hidden'; key = 'data-node-id'; node.getAttribute(key)",
			"const read = node.getAttribute; read('data-node-id')",
			"const { querySelector: find } = doc; find('[data-node-id]')",
			"node.dataset['praxity-Private']",
		])
			assert.match(checkEditorSource(path, source).join("\n"), /T2:/, `${path}: ${source}`);
	for (const source of [
		"node.getAttribute('aria-hidden')",
		"node.closest('[role=tablist]')",
		"node.dataset.fixtureMenu = ''",
		"// node.dataset.nodeId\nconst ok = true",
	])
		assert.deepEqual(checkEditorSource(trustPaths[0], source), []);
	assert.deepEqual(
		checkEditorSource(
			"packages/editor-core/src/frame-bridge/page-lens.ts",
			"node.dataset.nodeId; node.closest('[data-praxity-chrome]')",
		),
		[],
	);
	assert.deepEqual(
		checkEditorSource(
			"packages/editor-core/src/frame-bridge/planted.test.ts",
			"node.dataset.nodeId; doc.addEventListener('keydown', handle)",
		),
		[],
	);
});

test("M2 and A1 reject planted handlers and live regions in new editing code", () => {
	const path = "packages/editor-core/src/frame-bridge/planted.tsx";
	for (const guardedPath of [path, "packages/editor-core/src/session/planted.ts"])
		for (const source of [
			'if (e.key === "Escape") close();',
			"if (e.key === 'Esc') close();",
			'<div aria-live="polite" />',
			'<div role="status" />',
			'node.setAttribute("role", "alert")',
			'node.role = "alert"',
			'node.ariaLive = "polite"',
		])
			assert.equal(checkEditorSource(guardedPath, source).length, 1, source);
	assert.equal(
		checkEditorSource(path, '// "Escape" is owned elsewhere\nconst ok = true;').length,
		0,
	);
	assert.equal(
		checkEditorSource(
			path,
			'node.querySelectorAll("[aria-live],[role=status]"); node.removeAttribute("aria-live");',
		).length,
		0,
	);
	assert.equal(
		checkEditorSource("apps/desktop/src/renderer/EditorView.tsx", 'e.key === "Escape"').length,
		0,
	);
	assert.equal(
		checkEditorSource("packages/editor-core/src/frame-bridge/escape.ts", 'e.key === "Escape"')
			.length,
		0,
	);
	assert.equal(
		checkEditorSource(
			"packages/editor-core/src/components/LiveRegion.tsx",
			'<div aria-live="polite" role="status" />',
		).length,
		0,
	);
});
