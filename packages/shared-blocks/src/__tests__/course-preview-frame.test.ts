import { expect, it, vi } from "vitest";
import { frameEdgeFocus, startInspectionPreview } from "../course-preview-frame";
import type { CoursePreviewCommand, CoursePreviewIdentity } from "../course-preview-protocol";

const channel = "c".repeat(32);
const identity: CoursePreviewIdentity = {
	channel,
	courseId: "course-1",
	revision: "a".repeat(64),
	pageId: "page-1",
};

// One runtime per document, as in a real inspection response.
it("connects only through its offered port and owns the Page lens keys and links", async () => {
	history.replaceState(
		null,
		"",
		`/r/page-1.html?praxity-inspect=1&praxity-channel=${channel}&praxity-parent-origin=https%3A%2F%2Fstudio.test`,
	);
	document.body.innerHTML = `<a id="page" href="page-2.html">Next</a>
<a id="external" href="https://example.com/">External</a>
<a id="other" href="data.json">Data</a>
<map name="m"><area id="area" href="page-2.html" alt="Area"></map>
<svg><a id="svg" href="page-2.html"><text>SVG</text></a></svg>
<svg><a id="xlink" xlink:href="page-2.html"><text>XLink</text></a></svg>
<svg><defs><a id="cloned" href="page-2.html"><rect/></a><g id="icon"><rect/></g></defs>
<use id="use-link" href="#cloned"/><use id="use-icon" href="#icon"/><use id="use-sprite" href="sprite.svg#x"/></svg>
<a href="page-2.html"><svg><use id="use-in-link" href="#icon"/></svg></a>
<a id="skip" href="#main">Skip</a><a id="toc" href="#block-1">Section</a>
<a id="accented" href="#café">Café</a><a id="malformed" href="#%E0%A4%A">Bad</a>
<main id="main" tabindex="-1"></main><section id="block-1"></section><section id="café"></section>
<button>Last</button>`;
	const offers: { data: unknown; origin: string; port: MessagePort | undefined }[] = [];
	Object.defineProperty(window, "parent", {
		configurable: true,
		value: {
			postMessage: (data: unknown, origin: string, transfer: MessagePort[]) =>
				offers.push({ data, origin, port: transfer[0] }),
		},
	});
	const onConnect = vi.fn();
	expect(startInspectionPreview(window, onConnect)).toBe(true);
	expect(offers).toHaveLength(1);
	const [{ data, origin, port }] = offers;
	expect(data).toEqual({ source: "praxity-course", version: 1, event: "inspect", channel });
	expect(origin).toBe("https://studio.test");
	if (!port) throw new Error("The inspection runtime did not offer a port.");
	const events: Record<string, unknown>[] = [];
	port.onmessage = (event) => events.push(event.data);
	port.start();
	const command = (body: Record<string, unknown>) =>
		port.postMessage({
			source: "praxity-studio",
			version: 1,
			...identity,
			...body,
		} as CoursePreviewCommand);

	// Window messages carry no authority, and nothing answers before the host connects.
	window.dispatchEvent(
		new MessageEvent("message", {
			data: { source: "praxity-studio", version: 1, action: "connect", ...identity },
			origin: "https://studio.test",
		}),
	);
	command({ action: "restore", state: "{}", writable: false });
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(events).toEqual([]);
	command({ action: "connect" });
	await vi.waitFor(() => expect(events).toHaveLength(1));
	expect(events[0]).toEqual({
		source: "praxity-course",
		version: 1,
		event: "connected",
		...identity,
	});
	expect(onConnect).toHaveBeenCalledWith(identity, "https://studio.test");
	command({ action: "restore", state: "{}", writable: false });
	await vi.waitFor(() =>
		expect(events.at(-1)).toMatchObject({ event: "ready", mode: "inspection" }),
	);

	command({ action: "focus", edge: "last" });
	await vi.waitFor(() => expect(document.activeElement?.localName).toBe("button"));
	const key = (init: KeyboardEventInit) => {
		const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
		document.activeElement?.dispatchEvent(event);
		return event.defaultPrevented;
	};
	expect(key({ key: "Tab" })).toBe(true);
	expect(key({ key: "ArrowRight", ctrlKey: true })).toBe(true);
	expect(key({ key: "Escape" })).toBe(false);
	await vi.waitFor(() => expect(events).toHaveLength(5));
	expect(events.slice(2).map(({ event, direction }) => [event, direction])).toEqual([
		["focus-boundary", "forward"],
		["author-bypass", "next"],
		["escape", undefined],
	]);

	// No link navigates the lens. Page links ask the host, which remounts the page.
	const activate = (id: string, type = "click") => {
		const event = new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			button: type === "click" ? 0 : 1,
		});
		const target = document.getElementById(id);
		(target?.firstChild ?? target)?.dispatchEvent(event);
		return event.defaultPrevented;
	};
	for (const id of ["page", "external", "other", "area", "svg", "xlink"])
		expect(activate(id)).toBe(true);
	expect(activate("page", "auxclick")).toBe(true);
	await vi.waitFor(() => expect(events).toHaveLength(10));
	const page2 = new URL("/r/page-2.html", location.href).href;
	expect(events.slice(5).map(({ event, url }) => [event, url])).toEqual([
		["navigate", page2],
		["open-external", "https://example.com/"],
		["navigate", page2],
		["navigate", page2],
		["navigate", page2],
	]);

	// A <use> click retargets away from any cloned link, so every <use> click is cancelled.
	expect(activate("use-link")).toBe(true);
	expect(activate("use-sprite")).toBe(true);
	expect(activate("use-icon")).toBe(true);
	// A light-DOM link around the <use> still asks the host for its page.
	expect(activate("use-in-link")).toBe(true);
	await vi.waitFor(() => expect(events).toHaveLength(11));
	expect(events.at(-1)).toMatchObject({ event: "navigate", url: page2 });
	// Same-page links move focus in place; they neither load nor ask the host for a page.
	expect(activate("skip")).toBe(true);
	expect(document.activeElement?.id).toBe("main");
	expect(activate("toc")).toBe(true);
	expect(document.activeElement?.id).toBe("block-1");
	// The browser decodes the fragment before it looks up the target; malformed encoding finds nothing.
	expect(activate("accented")).toBe(true);
	expect(document.activeElement?.id).toBe("café");
	expect(activate("malformed")).toBe(true);
	expect(document.activeElement?.id).toBe("café");
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(events).toHaveLength(11);
});

it("focuses a frame edge only when the entry left no element focused", () => {
	document.body.innerHTML = '<a href="#main">Skip</a><main id="main"></main><button>Last</button>';
	const [skip, last] = [...document.querySelectorAll<HTMLElement>("a,button")];
	const focusEdge = frameEdgeFocus(window);
	// WebKit, when Tab finds no stop inside the frame, focuses only its document.
	window.dispatchEvent(new FocusEvent("focus"));
	focusEdge("first");
	expect(document.activeElement).toBe(skip);
	focusEdge("last");
	expect(document.activeElement).toBe(skip);
	// Another entry, where the browser chose its own stop.
	window.dispatchEvent(new FocusEvent("focus"));
	last.focus();
	focusEdge("first");
	expect(document.activeElement).toBe(last);
	window.dispatchEvent(new FocusEvent("focus"));
	focusEdge("first");
	expect(document.activeElement).toBe(skip);
});
