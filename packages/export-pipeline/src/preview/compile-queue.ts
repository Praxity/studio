const QUIET_WINDOW_MS = 100;
const MAX_WAIT_MS = 400;

export interface CompileJob {
	readonly pageId: string;
	readonly seq: number;
}
export interface CompileRequest {
	seq: number;
	pageIds: readonly string[];
	visiblePageId: string;
}
interface Entry {
	seq: number;
	pending: boolean;
	leading: boolean;
	requestedAt: number;
	startedAt: number;
}

function deadline(entry: Entry): number {
	return Math.min(entry.requestedAt + QUIET_WINDOW_MS, entry.startedAt + MAX_WAIT_MS);
}

/** A page gets one leading job per burst, then waits for 100 ms of quiet,
 * with another compile at least every 400 ms while edits continue.
 * The clock is supplied by the host; this queue owns no timers or compiler. */
export class CompileQueue {
	private readonly entries = new Map<string, Entry>();
	private running: CompileJob | null = null;
	private visiblePageId = "";
	private readonly counts = { compiles: 0, coalesced: 0, discarded: 0 };
	constructor(private readonly now: () => number = Date.now) {}

	request({ seq, pageIds, visiblePageId }: CompileRequest): void {
		if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("Invalid compile sequence.");
		this.visiblePageId = visiblePageId;
		const now = this.now();
		for (const pageId of new Set(pageIds)) {
			const previous = this.entries.get(pageId);
			if (previous && seq <= previous.seq) continue;
			const leading =
				!previous ||
				previous.leading ||
				(!previous.pending &&
					this.running?.pageId !== pageId &&
					now - previous.requestedAt >= QUIET_WINDOW_MS);
			if (previous && !leading) this.counts.coalesced++;
			this.entries.set(pageId, {
				seq,
				pending: true,
				leading,
				requestedAt: now,
				startedAt: previous?.startedAt ?? now,
			});
		}
	}

	/** Redo output suppressed by a draft without opening another leading slot. */
	retry(job: CompileJob): void {
		const entry = this.entries.get(job.pageId);
		if (!entry || entry.seq !== job.seq || entry.pending || this.running?.pageId === job.pageId)
			return;
		entry.pending = true;
		entry.requestedAt = this.now();
	}

	/** Earliest wake-up, or null while running/idle. The visible page wins ties. */
	readyAt(): number | null {
		if (this.running) return null;
		let earliest: number | null = null;
		for (const entry of this.entries.values()) {
			if (!entry.pending) continue;
			const ready = entry.leading ? this.now() : deadline(entry);
			earliest = earliest === null ? ready : Math.min(earliest, ready);
		}
		return earliest;
	}

	next(): CompileJob | null {
		if (this.running) return null;
		const ready = [...this.entries].filter(
			([, entry]) => entry.pending && (entry.leading || this.now() >= deadline(entry)),
		);
		const selected = ready.find(([pageId]) => pageId === this.visiblePageId) ?? ready[0];
		if (!selected) return null;
		const [pageId, entry] = selected;
		entry.pending = false;
		entry.leading = false;
		entry.startedAt = this.now();
		this.running = { pageId, seq: entry.seq };
		this.counts.compiles++;
		return this.running;
	}

	complete<T>(job: CompileJob, result: T): T | null {
		if (job !== this.running) throw new Error("Compile job is not running.");
		this.running = null;
		if (this.entries.get(job.pageId)?.seq !== job.seq) {
			this.counts.discarded++;
			return null;
		}
		return result;
	}

	stats(): { compiles: number; coalesced: number; discarded: number } {
		return { ...this.counts };
	}

	retainPages(pageIds: readonly string[]): void {
		const present = new Set(pageIds);
		for (const pageId of this.entries.keys()) if (!present.has(pageId)) this.entries.delete(pageId);
	}
}
