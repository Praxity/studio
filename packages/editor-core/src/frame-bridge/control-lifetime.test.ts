import { setImmediate } from "node:timers/promises";
import { queryObjects } from "node:v8";
import { expect, it, vi } from "vitest";
import { mountPageLens } from "./page-lens";
import type { FrameView } from "./protocol";

it("retired handles and shadow adapters can be collected while the lens stays alive", async () => {
	window.history.replaceState(null, "", "?praxity-inspect=1");
	document.body.innerHTML = "<main><h1>Page</h1></main>";
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(80, 80, 300, 100),
	);
	const view: FrameView = {
		file: "a.prax",
		pageId: "page",
		language: "en",
		alwaysShowHandles: false,
		nodes: [{ id: "page", kind: "page", parentId: null, name: "Page", description: "Page 1" }],
		selected: [],
		expanded: [],
		focus: null,
	};
	const lens = mountPageLens({ document, view, onEvent: () => {} });
	const refs: WeakRef<Element>[] = [];
	function retire(index: number) {
		const id = `temporary-${index}`;
		const paragraph = document.createElement("p");
		paragraph.setAttribute("data-node-id", id);
		paragraph.textContent = "Temporary";
		document.querySelector("main")?.append(paragraph);
		lens.render({
			...view,
			nodes: [
				...view.nodes,
				{ id, kind: "block", parentId: "page", name: "Temporary", description: "Block 1" },
			],
		});
		const handle = document.querySelector(`button[data-node-id="${id}"]`);
		if (!handle) throw new Error("Missing temporary handle");
		refs.push(new WeakRef(handle));
		const host = document.createElement("div");
		document.body.append(host);
		const root = host.attachShadow({ mode: "closed" });
		const field = document.createElement("textarea");
		root.append(field);
		lens.registerControl(field, { file: view.file, nodeId: id, role: "source" });
		refs.push(new WeakRef(field));
		lens.render(view);
		paragraph.remove();
		host.remove();
		lens.refresh();
	}
	try {
		for (let i = 0; i < 20; i++) retire(i);
		await setImmediate();
		// Node's heap query performs collection without requiring a test-only GC global.
		queryObjects(WeakRef);
		await setImmediate();
		expect(refs.filter((ref) => ref.deref()).length).toBe(0);
	} finally {
		lens.dispose();
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	}
});
