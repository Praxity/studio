import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

try {
	const { values } = parseArgs({ options: { base: { type: "string" } } });
	if (!/^[a-f0-9]{40}$/i.test(values.base ?? "")) throw new Error("A pinned base SHA is required");
	// Detached maintenance can rewrite .git/shallow during the next fetch.
	const git = (...args) =>
		execFileSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
			encoding: "utf8",
		}).trim();
	const objectKiB = () =>
		[...git("count-objects", "-v").matchAll(/^(?:size|size-pack): (\d+)$/gm)].reduce(
			(sum, match) => sum + Number(match[1]),
			0,
		);
	const checkoutKiB = objectKiB();
	const head = git("rev-parse", "HEAD");
	git("fetch", "--no-tags", "--depth=1", "origin", values.base);
	let depth = 1;
	let fetchedFullHistory = false;
	for (;;) {
		const result = spawnSync("git", ["merge-base", "HEAD", values.base], { encoding: "utf8" });
		if (result.error) throw result.error;
		if (result.status === 0) break;
		if (result.status !== 1) throw new Error(result.stderr || "git merge-base failed");
		if (fetchedFullHistory)
			throw new Error(
				"No merge base after full timeout history fetch; check the pinned head/base and origin history",
			);
		if (git("rev-parse", "--is-shallow-repository") !== "true")
			throw new Error("Head and base have no common ancestor");
		// A successful deepen can leave the pinned PR merge tip shallow indefinitely.
		// Bound incremental fetches to 63 commits before requesting both full histories once.
		if (depth > 32) {
			console.log("Fetching full timeout comparison ancestry after bounded deepening");
			git("fetch", "--no-tags", "--unshallow", "origin", head, values.base);
			fetchedFullHistory = true;
			continue;
		}
		console.log(`Deepening timeout comparison ancestry by ${depth} commits`);
		git("fetch", "--no-tags", `--deepen=${depth}`, "origin", head, values.base);
		depth *= 2;
	}
	console.log(
		`Timeout checkout objects: ${checkoutKiB} KiB; comparison fetch added ${objectKiB() - checkoutKiB} KiB`,
	);
} catch (error) {
	console.error(`Timeout history fetch failed: ${error.message}`);
	process.exitCode = 1;
}
