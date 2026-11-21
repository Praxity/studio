export function isTrustedEditorInput(
	event: { isTrusted: boolean; target: EventTarget | null },
	doc: Document,
) {
	const source = event.target;
	return (
		event.isTrusted &&
		(source === doc || source === doc.defaultView || (source as Node | null)?.ownerDocument === doc)
	);
}

export function listenEditorInput<K extends keyof DocumentEventMap>(
	doc: Document,
	type: K,
	receive: (event: DocumentEventMap[K]) => void,
	capture = false,
	onWindow = false,
	root: Document | ShadowRoot = doc,
) {
	const target = onWindow ? (doc.defaultView ?? doc) : root;
	const listener = (event: Event) => {
		if (isTrustedEditorInput(event, doc)) receive(event as DocumentEventMap[K]);
	};
	target.addEventListener(type, listener, capture);
	return () => target.removeEventListener(type, listener, capture);
}

export function listenFrameMessages(
	win: Window,
	origin: string,
	source: () => Window | null,
	receive: (event: MessageEvent) => void,
) {
	const listener = (event: MessageEvent) => {
		const expectedSource = source();
		if (
			event.isTrusted &&
			expectedSource &&
			event.origin === origin &&
			event.source === expectedSource
		)
			receive(event);
	};
	win.addEventListener("message", listener);
	return () => win.removeEventListener("message", listener);
}

export function listenPrivatePort(port: MessagePort, receive: (event: MessageEvent) => void) {
	port.addEventListener("message", receive);
	port.start();
	return () => port.removeEventListener("message", receive);
}
