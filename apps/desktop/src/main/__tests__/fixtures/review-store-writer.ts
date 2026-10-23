import { once } from "node:events";
import { openReviewStore } from "../../studio/review-store";

process.send?.("ready");
process.once("message", async ({ root, payload }: { root: string; payload: unknown }) => {
	try {
		const store = await openReviewStore(root);
		const principal = await store.principalFor("reviewer", "local-preview");
		const start = once(process, "message");
		process.send?.("prepared");
		await start;
		const result = await store.create(principal, payload);
		if (!result.ok) throw new Error(JSON.stringify(result));
		process.send?.("saved");
		process.disconnect();
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
		process.disconnect();
	}
});
