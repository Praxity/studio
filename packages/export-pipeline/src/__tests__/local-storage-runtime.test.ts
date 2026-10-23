import { LEARNER_STATE_MAX_BYTES } from "@praxity/shared-blocks/learner-state";
import { describe, expect, it } from "vitest";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";

function createStorage(): Storage & { failWrites: boolean } {
	const values = new Map<string, string>();
	return {
		failWrites: false,
		get length() {
			return values.size;
		},
		clear() {
			values.clear();
		},
		getItem(key) {
			return values.get(key) ?? null;
		},
		key(index) {
			return Array.from(values.keys())[index] ?? null;
		},
		removeItem(key) {
			values.delete(key);
		},
		setItem(key, value) {
			if (this.failWrites) throw new Error("storage quota exceeded");
			values.set(key, value);
		},
	};
}

describe("LocalStorageRuntime learner state writes", () => {
	it("keeps unscoped legacy reads and writes outside scoped learner state", () => {
		const storage = createStorage();
		const runtime = new LocalStorageRuntime(storage);
		expect(runtime.getVisitedPages()).toEqual([]);
		expect(runtime.getInteractions()).toEqual([]);
		expect(runtime.getCompletion()).toBe("incomplete");
		expect(runtime.getScore()).toBeNull();
		expect(runtime.getBookmark()).toBeNull();
		expect(runtime.getSuspendData()).toBeNull();
		expect(runtime.getBlockState("check")).toBeUndefined();
		runtime.trackPageVisit("first");
		runtime.setBookmark("first");
		runtime.setScore(50, 0, 100);
		expect(runtime.getVisitedPages()).toEqual(["first"]);
		expect(runtime.getBookmark()).toBe("first");
		expect(runtime.getScore()).toEqual({ raw: 50, min: 0, max: 100 });
		expect(storage.getItem("praxity_bookmark")).toBe("first");
	});
	it.each(["state", "bookmark"])("falls back when Storage denies a %s read", (key) => {
		const storage = createStorage();
		const getItem = storage.getItem.bind(storage);
		storage.getItem = (name) => {
			if (name.endsWith(`:${key}`)) throw new DOMException("Denied read", "SecurityError");
			return getItem(name);
		};
		const runtime = new LocalStorageRuntime(storage, "course", "attempt");
		expect(runtime.initialize()).toBe(true);
		expect(runtime.getBookmark()).toBeNull();
		runtime.trackPageVisit("page-one");
		runtime.setBookmark("page-one");
		expect(runtime.getVisitedPages()).toEqual(["page-one"]);
		expect(runtime.getBookmark()).toBe("page-one");
	});
	it("starts fresh in memory without deleting legacy state when migration exceeds quota", () => {
		const storage = createStorage();
		storage.setItem("praxity:course:attempt:bookmark", "page-three");
		storage.setItem = () => {
			throw new DOMException("Storage quota exceeded", "QuotaExceededError");
		};
		const runtime = new LocalStorageRuntime(storage, "course", "attempt");
		expect(runtime.getBookmark()).toBeNull();
		expect(storage.getItem("praxity:course:attempt:bookmark")).toBe("page-three");
		expect(storage.getItem("praxity:course:attempt:state")).toBeNull();
		runtime.setBookmark("page-one");
		expect(runtime.getBookmark()).toBe("page-one");
	});
	it("retains unexpected storage failures", () => {
		const storage = createStorage();
		storage.getItem = () => {
			throw new Error("Unexpected storage failure");
		};
		expect(() => new LocalStorageRuntime(storage, "course")).toThrow("Unexpected storage failure");
	});
	it("keeps the fresh in-memory attempt writable after a reset and a late read denial", () => {
		const storage = createStorage();
		const runtime = new LocalStorageRuntime(storage, "course", "attempt");
		runtime.resetState();
		storage.getItem = () => {
			throw new DOMException("Denied read", "SecurityError");
		};
		expect(runtime.getBookmark()).toBeNull();
		runtime.setBookmark("page-one");
		expect(runtime.getBookmark()).toBe("page-one");
	});
	it.each(["SecurityError", "UnexpectedError"])("handles a storage accessor %s", (name) => {
		const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new DOMException("Storage disabled", name);
			},
		});
		try {
			const injected = new LocalStorageRuntime(createStorage(), "injected-course");
			injected.setBookmark("page-two");
			expect(injected.getBookmark()).toBe("page-two");
			if (name !== "SecurityError") {
				expect(() => new LocalStorageRuntime(undefined, "restricted-course")).toThrow(
					"Storage disabled",
				);
				return;
			}
			const runtime = new LocalStorageRuntime(undefined, "restricted-course");
			expect(runtime.initialize()).toBe(true);
			expect(runtime.getVisitedPages()).toEqual([]);
			expect(() => runtime.trackPageVisit("page-two")).not.toThrow();
			expect(runtime.getBookmark()).toBeNull();
		} finally {
			if (original) Object.defineProperty(globalThis, "localStorage", original);
			else Reflect.deleteProperty(globalThis, "localStorage");
		}
	});

	it("separates learner state by course and attempt", () => {
		const storage = createStorage();
		const firstAttempt = new LocalStorageRuntime(storage, "course-a", "attempt-1");
		const secondAttempt = new LocalStorageRuntime(storage, "course-a", "attempt-2");
		const otherCourse = new LocalStorageRuntime(storage, "course-b", "attempt-1");

		firstAttempt.setBookmark("page-1");
		firstAttempt.setBlockState("checklist-1", { checked: ["item-1"] });

		expect(firstAttempt.getBookmark()).toBe("page-1");
		expect(firstAttempt.getBlockState("checklist-1")).toEqual({ checked: ["item-1"] });
		expect(secondAttempt.getBookmark()).toBeNull();
		expect(secondAttempt.getBlockState("checklist-1")).toBeUndefined();
		expect(otherCourse.getBookmark()).toBeNull();
		expect(otherCourse.getBlockState("checklist-1")).toBeUndefined();
	});

	it("keeps the last valid state when serialization rejects an oversized update", () => {
		const storage = createStorage();
		const runtime = new LocalStorageRuntime(storage, "course", "attempt");
		runtime.setBlockState("stable", { value: 1 });
		const previous = storage.getItem("praxity:course:attempt:state");

		expect(() =>
			runtime.setBlockState("oversized", {
				value: "x".repeat(LEARNER_STATE_MAX_BYTES),
			}),
		).not.toThrow();
		expect(storage.getItem("praxity:course:attempt:state")).toBe(previous);
		expect(runtime.getBlockState("stable")).toEqual({ value: 1 });
		expect(runtime.getBlockState("oversized")).toBeUndefined();
	});

	it("keeps the last valid state when storage rejects a write", () => {
		const storage = createStorage();
		const runtime = new LocalStorageRuntime(storage, "course", "attempt");
		runtime.setBlockState("stable", { value: 1 });
		const previous = storage.getItem("praxity:course:attempt:state");
		storage.failWrites = true;

		expect(() => runtime.setBlockState("new", { value: 2 })).not.toThrow();
		expect(storage.getItem("praxity:course:attempt:state")).toBe(previous);
		expect(runtime.getBlockState("stable")).toEqual({ value: 1 });
		expect(runtime.getBlockState("new")).toBeUndefined();
	});
});
