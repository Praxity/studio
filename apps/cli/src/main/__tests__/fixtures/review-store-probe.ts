import { once } from "node:events";
import { open } from "node:fs/promises";
import { withProjectFileTransaction } from "../../project-file-transactions";
import { openReviewStore } from "../../studio/review-store";

const [mode, root] = process.argv.slice(2);
try {
	if (mode === "hold") {
		await withProjectFileTransaction(
			root,
			async () => {
				const release = once(process, "message");
				process.send?.("locked");
				await release;
			},
			"write",
			false,
		);
	} else if (mode === "file-hold") {
		const handle = await open(root, "r");
		try {
			const release = once(process, "message");
			process.send?.("file-open");
			await release;
		} finally {
			await handle.close();
		}
	} else if (mode === "cold-list" || mode === "cold-principal") {
		const store = await openReviewStore(root);
		const principal = await store.principalFor("reviewer", "local-preview");
		const start = once(process, "message");
		process.send?.("ready");
		await start;
		const result =
			mode === "cold-list"
				? await store.list(principal)
				: await store.principalFor("reviewer", "local-preview");
		process.send?.(result);
	} else if (mode === "first-use") {
		const start = once(process, "message");
		process.send?.("ready");
		const [payload] = await start;
		const store = await openReviewStore(root);
		const principal = await store.principalFor("reviewer", "local-preview");
		const result = await store.create(principal, { ...payload, reviewId: store.reviewId });
		process.send?.({ reviewId: store.reviewId, result });
	}
} catch (error) {
	process.send?.({
		error: String(error),
		code: (error as { code?: string }).code,
		causeCode: (error as { cause?: { code?: string } }).cause?.code,
	});
	process.exitCode = 1;
}
process.disconnect();
