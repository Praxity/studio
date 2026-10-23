import { installDistractorReveal } from "../../src/patterns/write-distractors/reveal";

export { installDistractorReveal };

import { admitWriteDistractorsAsset } from "@praxity/shared-blocks/write-distractors-content";
import type { WriteDistractorsReference } from "@praxity/shared-blocks/write-distractors-session";

const callbacks = new WeakMap<HTMLScriptElement, (payload: unknown) => void>();
const installed = new WeakSet<Window>();
export function loadWriteDistractorsAsset(reference: WriteDistractorsReference, doc: Document) {
	const view = doc.defaultView;
	if (!view || !/^write-distractors\/[a-f0-9]{64}\.js$/.test(reference.path))
		return Promise.reject(new Error("EWRITEDISTRACTORSASSET"));
	if (!installed.has(view)) {
		(
			view as Window & { __praxityWriteDistractorsAsset?: (payload: unknown) => void }
		).__praxityWriteDistractorsAsset = (payload) => {
			const script = doc.currentScript;
			if (script instanceof view.HTMLScriptElement) callbacks.get(script)?.(payload);
		};
		installed.add(view);
	}
	return new Promise<ReturnType<typeof admitWriteDistractorsAsset>>((resolve, reject) => {
		const script = doc.createElement("script");
		let captured: unknown;
		const clean = () => {
			callbacks.delete(script);
			script.remove();
		};
		callbacks.set(script, (payload) => {
			captured = payload;
		});
		script.onload = () => {
			clean();
			try {
				resolve(admitWriteDistractorsAsset(captured, reference));
			} catch (error) {
				reject(error);
			}
		};
		script.onerror = () => {
			clean();
			reject(new Error("EWRITEDISTRACTORSLOAD"));
		};
		script.src = new URL(reference.path, doc.baseURI).href;
		doc.head.append(script);
	});
}

if (typeof window !== "undefined")
	window.__praxityDistractorsSupport = {
		loadWriteDistractorsAsset,
		installDistractorReveal,
	};
