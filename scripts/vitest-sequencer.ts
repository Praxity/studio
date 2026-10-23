import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer, type TestModule, type TestSpecification, type Vitest } from "vitest/node";

const committedTimings = JSON.parse(
	readFileSync(new URL("./vitest-timings.json", import.meta.url), "utf8"),
);

function distribute<T>(
	files: T[],
	name: (file: T) => string,
	timings: Record<string, number>,
	count: number,
	workerCount: number,
) {
	const shards: T[][] = Array.from({ length: count }, () => []);
	const workers = Array.from({ length: count }, () => Array<number>(workerCount).fill(0));
	const totals = Array<number>(count).fill(0);
	const ordered = [...files].sort(
		(a, b) => timings[name(b)] - timings[name(a)] || name(a).localeCompare(name(b)),
	);
	for (const file of ordered) {
		const shard = totals.indexOf(Math.min(...totals));
		shards[shard].push(file);
		const worker = workers[shard].indexOf(Math.min(...workers[shard]));
		workers[shard][worker] += timings[name(file)];
		totals[shard] = Math.max(...workers[shard]);
	}
	return shards;
}

export default class DurationSequencer extends BaseSequencer {
	private timings: Record<string, number>;

	constructor(ctx: Vitest, timings: Record<string, number> = committedTimings.files) {
		super(ctx);
		this.timings = timings;
	}

	async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
		const selection = this.ctx.config.shard;
		if (!selection) return files;
		const { index, count } = selection;
		const name = (file: TestSpecification) =>
			relative(this.ctx.config.root, file.moduleId).replaceAll("\\", "/");
		const known = files.filter((file) => this.timings[name(file)] !== undefined);
		const unknown = files.filter((file) => this.timings[name(file)] === undefined);
		const shards = distribute(known, name, this.timings, count, committedTimings.workers);
		return [...shards[index - 1], ...(await super.shard(unknown))];
	}
}

// JSON lines in the ordinary CI log let timing refreshes survive artifact quotas.
export class FileTimingReporter {
	private ctx: Vitest | undefined;

	onInit(ctx: Vitest) {
		this.ctx = ctx;
	}

	onTestModuleEnd(module: TestModule) {
		const duration = module.diagnostic().duration;
		if (this.ctx && duration !== undefined)
			this.ctx.logger.log(
				`Vitest file timing: ${JSON.stringify({
					file: relative(this.ctx.config.root, module.moduleId).replaceAll("\\", "/"),
					duration: Math.ceil(duration),
				})}`,
			);
	}
}
