import { expect, it, vi } from "vitest";
import { createSelfCheckSession } from "./self-check-session";

const references = ["a", "b"].map((blockId) => ({
	blockId,
	path: "asset",
	contentRevision: "revision",
}));
function fixture() {
	const write = vi.fn();
	const session = createSelfCheckSession(references, {
		startupPending: true,
		read: () => undefined,
		write,
		admit: async () => {
			throw new Error("unused admission");
		},
	});
	return { session, write };
}

it("an unrelated optional admission cannot hold the gate snapshot", async () => {
	const session = createSelfCheckSession(
		[...references.slice(0, 1), { ...references[1], independent: true }],
		{
			read: (id) => (id === "b" ? { saved: true } : undefined),
			write: vi.fn(),
			admit: () => new Promise(() => {}),
		},
	);
	expect(session.read("a")).toMatchObject({ ready: true, available: true, completed: false });
	expect(session.read("b")).toMatchObject({ outcome: "pending", available: false });
	session.dispose();
});

it("empty members cannot settle readiness before required startup attaches", async () => {
	const { session, write } = fixture();
	const settled = vi.fn();
	void session.ready.then(settled);
	await Promise.resolve();
	expect(session.read("a")).toMatchObject({
		ready: false,
		available: false,
		completed: false,
		startup: "pending",
	});
	expect(settled).not.toHaveBeenCalled();
	session.startup("ready");
	expect(await session.ready).toMatchObject({ ready: true, startup: "ready" });
	expect(session.read("b")).toMatchObject({ outcome: "empty", available: true });
	expect(write).not.toHaveBeenCalled();
});

it("failed startup is readable by later consumers and only attachment recovers it", async () => {
	const { session } = fixture();
	session.startup("unavailable");
	expect(await session.ready).toMatchObject({
		startup: "unavailable",
		failures: [
			{ blockId: "a", code: "comparison-unavailable" },
			{ blockId: "b", code: "comparison-unavailable" },
		],
	});
	await session.dispatch({ type: "edit", blockId: "a", answer: "Retained draft" });
	await session.dispatch({ type: "start-over", blockId: "b" });
	expect(session.read("a")).toMatchObject({
		startup: "unavailable",
		outcome: "unavailable",
		available: false,
	});
	expect(session.read("b")).toMatchObject({ outcome: "unavailable", available: false });
	const snapshots: unknown[] = [];
	session.subscribe((snapshot) => snapshots.push(snapshot));
	expect(snapshots[0]).toMatchObject({ startup: "unavailable" });
	session.startup("pending");
	expect(session.read("a")).toMatchObject({ ready: false, available: false });
	session.startup("ready");
	expect(session.draftAnswer("a")).toBe("Retained draft");
	expect(session.read("b")).toMatchObject({ outcome: "empty", available: true });
});

it("queued startup completion cannot revive a disposed owner", async () => {
	const { session } = fixture();
	session.dispose();
	session.startup("ready");
	expect(await session.ready).toMatchObject({ startup: "cancelled" });
	expect(session.read("a")).toMatchObject({ outcome: "cancelled", available: false });
});

for (const initial of ["pending", "unavailable"] as const)
	it(`reentrant startup keeps the last ${initial} phase and revokes the current ticket`, () => {
		const { session, write } = fixture();
		if (initial === "unavailable") session.startup("unavailable");
		let armed = true;
		session.subscribe((_snapshot, ticket) => {
			if (!armed) return;
			armed = false;
			session.startup(initial === "pending" ? "ready" : "pending");
			expect(ticket.current()).toBe(false);
			const queuedTicket = session.ticket();
			session.startup(initial);
			expect(queuedTicket.current()).toBe(false);
		});
		expect(session.read("a")).toMatchObject(
			initial === "pending"
				? { startup: "pending", ready: false, available: false, completed: false }
				: {
						startup: "unavailable",
						ready: true,
						outcome: "unavailable",
						available: false,
						completed: false,
						code: "comparison-unavailable",
					},
		);
		expect(write).not.toHaveBeenCalled();
	});
