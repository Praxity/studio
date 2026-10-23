import { availableParallelism } from "node:os";

export async function runFixtureBuilds(
	builds: ReadonlyArray<() => Promise<void>>,
	workers = availableParallelism(),
): Promise<void> {
	if (!Number.isInteger(workers) || workers < 1)
		throw new Error("Fixture workers must be a positive integer");
	let next = 0;
	const failures: Array<{ index: number; error: unknown }> = [];
	await Promise.all(
		Array.from({ length: Math.min(workers, builds.length) }, async () => {
			while (next < builds.length) {
				const index = next++;
				try {
					await builds[index]();
				} catch (error) {
					failures.push({ index, error });
				}
			}
		}),
	);
	// All writers settle before setup can remove their shared output directory.
	if (failures.length)
		throw new AggregateError(
			failures.sort((a, b) => a.index - b.index).map(({ error }) => error),
			"Accessibility fixture builds failed",
		);
}
