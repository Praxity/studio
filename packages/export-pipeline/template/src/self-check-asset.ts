interface AssetReference {
	blockId: string;
	contentRevision: string;
	path: string;
}
const callbacks = new WeakMap<HTMLScriptElement, (payload: unknown) => void>();
const installed = new WeakSet<Window>();
const assetError = (code: string) => Object.assign(new Error(code), { code });

/** Classic packaged scripts also load from file://. S7 calls this after action. */
export function loadSelfCheckAsset(
	reference: AssetReference,
	doc: Document = document,
): Promise<unknown> {
	const { blockId, contentRevision, path } = reference;
	const view = doc.defaultView;
	if (
		!view ||
		typeof blockId !== "string" ||
		typeof contentRevision !== "string" ||
		!/^self-check\/[a-f0-9]{64}\.js$/.test(path)
	)
		return Promise.reject(assetError("self-check-asset-invalid"));
	if (!installed.has(view)) {
		(
			view as Window & { __praxitySelfCheckAsset?: (payload: unknown) => void }
		).__praxitySelfCheckAsset = (payload) => {
			const script = doc.currentScript;
			if (script instanceof view.HTMLScriptElement) callbacks.get(script)?.(payload);
		};
		installed.add(view);
	}
	return new Promise((resolve, reject) => {
		const script = doc.createElement("script");
		let captured: unknown;
		let valid = false;
		const clean = () => {
			callbacks.delete(script);
			script.remove();
		};
		callbacks.set(script, (payload) => {
			valid =
				!!payload &&
				typeof payload === "object" &&
				"blockId" in payload &&
				payload.blockId === blockId &&
				"contentRevision" in payload &&
				payload.contentRevision === contentRevision;
			captured = valid ? payload : undefined;
		});
		script.onload = () => {
			clean();
			if (valid) resolve(captured);
			else reject(assetError("self-check-asset-revision"));
		};
		script.onerror = () => {
			clean();
			reject(assetError("self-check-asset-unavailable"));
		};
		script.src = new URL(path, doc.baseURI).href;
		doc.head.append(script);
	});
}
