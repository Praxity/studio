/** DOM seam for protocol tests: jsdom cannot deliver cross-origin native messages.
 * Browser specs exercise native isTrusted, origin, source and port transfers.
 */
export function nativeMessageWindow(win: Window): Window {
	const listeners = new Map<EventListenerOrEventListenerObject, EventListener>();
	return new Proxy(win, {
		get(target, key) {
			if (key === "addEventListener")
				return (
					type: string,
					receive: EventListener,
					options?: boolean | AddEventListenerOptions,
				) => {
					if (type !== "message") return target.addEventListener(type, receive, options);
					const listener = (event: Event) => {
						const message = event as MessageEvent;
						receive({
							isTrusted: true,
							data: message.data,
							origin: message.origin,
							source: message.source,
							ports: message.ports,
						} as MessageEvent);
					};
					listeners.set(receive, listener);
					target.addEventListener(type, listener, options);
				};
			if (key === "removeEventListener")
				return (type: string, receive: EventListener, options?: boolean | EventListenerOptions) => {
					target.removeEventListener(type, listeners.get(receive) ?? receive, options);
					listeners.delete(receive);
				};
			return Reflect.get(target, key, target);
		},
	});
}
