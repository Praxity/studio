import { vi } from "vitest";

/** jsdom seam only; browser specs prove genuine input admission. */
export function nativeInput<T extends Document | ShadowRoot | HTMLElement>(doc: T): T {
	const win = "defaultView" in doc ? doc.defaultView : null;
	if (win) admit(win);
	admit(doc);
	return doc;
}
function admit(doc: Document | Window | ShadowRoot | HTMLElement) {
	const add = doc.addEventListener.bind(doc);
	const remove = doc.removeEventListener.bind(doc);
	const listeners = new Map<EventListenerOrEventListenerObject, EventListener>();
	vi.spyOn(doc, "addEventListener").mockImplementation(
		(
			type: string,
			receive: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) => {
			const listener = (event: Event) => {
				if (typeof receive !== "function") throw new Error("Expected function listener");
				receive(
					new Proxy(event, {
						get(input, property) {
							if (property === "isTrusted") return true;
							const value = Reflect.get(input, property, input);
							return typeof value === "function" ? value.bind(input) : value;
						},
					}),
				);
			};
			listeners.set(receive, listener);
			add(type, listener, options);
		},
	);
	vi.spyOn(doc, "removeEventListener").mockImplementation(
		(
			type: string,
			receive: EventListenerOrEventListenerObject,
			options?: boolean | EventListenerOptions,
		) => {
			remove(type, listeners.get(receive) ?? receive, options);
			listeners.delete(receive);
		},
	);
}
