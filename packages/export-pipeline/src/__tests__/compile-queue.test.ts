import { describe, expect, it } from "vitest";
import { CompileQueue } from "../preview/compile-queue.ts";

describe("T3 compile burst window", () => {
	it("retries a completed revision through the existing quiet and maximum-wait deadlines", () => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
		const job = queue.next();
		if (!job) throw Error("Missing leading job");
		queue.complete(job, "held output");
		queue.retry(job);
		expect(queue.next()).toBeNull();
		expect(queue.readyAt()).toBe(100);
		now = 50;
		queue.retry(job);
		expect(queue.readyAt()).toBe(100);
		now = 100;
		const retried = queue.next();
		expect(retried).toEqual({ pageId: "page", seq: 1 });
		if (!retried) throw Error("Missing retry");
		queue.complete(retried, "visible output");
		now = 550;
		queue.retry(retried);
		expect(queue.next()).toEqual({ pageId: "page", seq: 1 });
	});
	it("an obsolete retry leaves the newer pending revision and its deadline intact", () => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
		const job = queue.next();
		if (!job) throw Error("Missing leading job");
		queue.complete(job, "held output");
		now = 20;
		queue.request({ seq: 2, pageIds: ["page"], visiblePageId: "page" });
		now = 50;
		queue.retry(job);
		expect(queue.readyAt()).toBe(120);
		now = 120;
		expect(queue.next()).toEqual({ pageId: "page", seq: 2 });
	});
	it("retries cannot resurrect a removed page or enqueue a running revision twice", () => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
		const job = queue.next();
		if (!job) throw Error("Missing leading job");
		queue.retry(job);
		queue.complete(job, "output");
		expect(queue.readyAt()).toBeNull();
		queue.retainPages([]);
		queue.retry(job);
		now = 500;
		expect(queue.next()).toBeNull();
	});
	it.each([0, 17, 200])("bounds a five-second continuous burst at %i ms cost", (cost) => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		const starts: number[] = [];
		let running: ReturnType<typeof queue.next> = null;
		let finish = 0;
		let delivered: number | null = null;
		for (now = 0; now <= 5500; now++) {
			if (running && now >= finish) {
				delivered = queue.complete(running, running.seq);
				running = null;
			}
			if (now <= 5000 && now % 20 === 0)
				queue.request({ seq: now / 20 + 1, pageIds: ["page"], visiblePageId: "page" });
			if (!running) {
				running = queue.next();
				if (running) {
					starts.push(now);
					finish = now + cost;
				}
			}
			if (now <= 5000) expect(now - (starts.at(-1) ?? 0)).toBeLessThan(400);
		}
		expect(starts.length).toBeGreaterThanOrEqual(13);
		expect(queue.stats().compiles).toBeLessThanOrEqual(14);
		expect(delivered).toBe(251);
	});
	it("keeps the maximum-wait deadline while new requests extend the quiet window", () => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
		const first = queue.next();
		if (!first) throw new Error("Missing leading job");
		queue.complete(first, "first");
		for (now = 20; now <= 380; now += 20)
			queue.request({ seq: now / 20 + 1, pageIds: ["page"], visiblePageId: "page" });
		expect(queue.readyAt()).toBe(400);
		now = 400;
		expect(queue.next()?.seq).toBe(20);
	});
	it.each([0, 1, 17, 57, 200])("five commits make two compiles at %i ms cost", (cost) => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		const starts: number[] = [];
		let running: ReturnType<typeof queue.next> = null;
		let finish = 0;
		for (now = 0; now < 500; now++) {
			if (running && now >= finish) {
				queue.complete(running, running.seq);
				running = null;
			}
			if (now <= 80 && now % 20 === 0)
				queue.request({ seq: now / 20 + 1, pageIds: ["page"], visiblePageId: "page" });
			if (!running) {
				running = queue.next();
				if (running) {
					starts.push(running.seq);
					finish = now + cost;
				}
			}
		}
		expect(starts).toEqual([1, 5]);
		expect(queue.stats().compiles).toBe(2);
	});
	it("starts a new leading compile after a quiet burst", () => {
		let now = 0;
		const queue = new CompileQueue(() => now);
		queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
		const first = queue.next();
		if (!first) throw new Error("Missing leading job");
		queue.complete(first, "first");
		now = 101;
		queue.request({ seq: 2, pageIds: ["page"], visiblePageId: "page" });
		expect(queue.next()?.seq).toBe(2);
	});
	it("keeps the leading slot when requests arrive before the first turn", () => {
		const queue = new CompileQueue(() => 0);
		queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
		queue.request({ seq: 2, pageIds: ["page"], visiblePageId: "page" });
		expect(queue.next()?.seq).toBe(2);
	});
	it("retires removed pages, including a running result", () => {
		const queue = new CompileQueue(() => 0);
		queue.request({ seq: 1, pageIds: ["page", "removed"], visiblePageId: "page" });
		const job = queue.next();
		if (!job) throw new Error("Missing job");
		queue.retainPages([]);
		expect(queue.complete(job, "deleted page")).toBeNull();
		expect(queue.next()).toBeNull();
		expect(queue.stats().discarded).toBe(1);
	});
	it("discards an older result after a newer request", () => {
		const queue = new CompileQueue(() => 0);
		queue.request({ seq: 3, pageIds: ["page"], visiblePageId: "page" });
		const job = queue.next();
		if (!job) throw new Error("Missing job");
		queue.request({ seq: 4, pageIds: ["page"], visiblePageId: "page" });
		expect(queue.complete(job, "stale HTML")).toBeNull();
		expect(queue.stats().discarded).toBe(1);
	});
	it("prioritizes the visible page and refuses replayed revisions", () => {
		const queue = new CompileQueue(() => 0);
		queue.request({ seq: 3, pageIds: ["hidden", "visible"], visiblePageId: "visible" });
		const job = queue.next();
		if (!job) throw new Error("Missing job");
		expect(job.pageId).toBe("visible");
		queue.complete(job, "good");
		queue.request({ seq: 2, pageIds: ["visible"], visiblePageId: "visible" });
		expect(queue.next()?.pageId).toBe("hidden");
	});
	it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid seq %s", (seq) => {
		const queue = new CompileQueue();
		expect(() => queue.request({ seq, pageIds: ["page"], visiblePageId: "page" })).toThrow();
	});
	it("rejects completion of a job that is not running", () => {
		const queue = new CompileQueue();
		expect(() => queue.complete({ pageId: "page", seq: 0 }, "bad")).toThrow();
	});
});
