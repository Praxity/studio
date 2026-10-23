import { type SelfCheckConsumers, selfCheckConsumers } from "./self-check-consumers";

/** Provider-ready starts the islands. Tracking joins the current owner's finalization. */
export function afterSelfCheckFinalization(
	doc: Document,
	effect: Parameters<SelfCheckConsumers["subscribe"]>[0],
	phase: "effects" | "tracking" | "settled" = "tracking",
) {
	if (!doc.documentElement.hasAttribute("data-self-check-dependencies")) {
		effect({ revision: 0, current: () => true });
		return () => {};
	}
	let release: (() => void) | undefined;
	let attached: SelfCheckConsumers | undefined;
	const attach = () => {
		const owner = selfCheckConsumers(doc);
		if (owner === attached) return;
		release?.();
		attached = owner;
		release = owner?.subscribe(effect, phase);
	};
	doc.addEventListener("praxity:self-check-owner", attach);
	attach();
	return () => {
		doc.removeEventListener("praxity:self-check-owner", attach);
		release?.();
	};
}
