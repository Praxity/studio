import { expect, it } from "vitest";
import {
	claimGroupObjective,
	type GroupObjectiveReplayLedger,
	settleGroupObjective,
	writeScormSuspendData,
} from "../src/scorm/api/session";

it("only the claiming attempt can acknowledge or release a UUID; written never regresses", () => {
	const ledger: GroupObjectiveReplayLedger = {};
	const first = claimGroupObjective(ledger, "g/P");
	expect(first).toBeDefined();
	expect(claimGroupObjective(ledger, "g/P")).toBeUndefined();
	const other = claimGroupObjective({}, "g/P");
	settleGroupObjective(ledger, "g/P", other, true);
	expect(ledger.objectives?.get("g/P")).toBe(first);
	settleGroupObjective(ledger, "g/P", first, false);
	expect(ledger.objectives?.has("g/P")).toBe(false);
	const retry = claimGroupObjective(ledger, "g/P");
	settleGroupObjective(ledger, "g/P", retry, true);
	expect(ledger.objectives?.get("g/P")).toBe("written");
	expect(claimGroupObjective(ledger, "g/P")).toBeUndefined();
	settleGroupObjective(ledger, "g/P", retry, false);
	settleGroupObjective(ledger, "g/P", undefined, false);
	expect(ledger.objectives?.get("g/P")).toBe("written");
});

it("the claiming attempt retains a nested accepted supersession when its own write refuses", () => {
	const ledger: GroupObjectiveReplayLedger = {};
	const claim = claimGroupObjective(ledger, "g/P");
	if (!claim) throw new Error("Missing claim");
	claim.acknowledged = true;
	settleGroupObjective(ledger, "g/P", claim, false);
	expect(ledger.objectives?.get("g/P")).toBe("written");
});

for (const outerAccepted of [true, false])
	it(`a nested accepted envelope survives the outer native write; accepted=${outerAccepted}`, () => {
		const ledger: GroupObjectiveReplayLedger = {};
		let stored = "before";
		let nested = false;
		const write = (value: string): boolean => {
			if (!nested) {
				nested = true;
				expect(writeScormSuspendData(ledger, "successor", write)).toBe(true);
			}
			if (value === "predecessor" && !outerAccepted) return false;
			stored = value;
			return true;
		};
		expect(writeScormSuspendData(ledger, "predecessor", write)).toBe(true);
		expect(stored).toBe("successor");
		expect(ledger.suspendWrite).toBeUndefined();
	});

it("a refused nested envelope cannot displace the accepted write", () => {
	const ledger: GroupObjectiveReplayLedger = {};
	let stored = "before";
	const write = (value: string): boolean => {
		if (value === "refused") return false;
		expect(writeScormSuspendData(ledger, "refused", write)).toBe(false);
		stored = value;
		return true;
	};
	expect(writeScormSuspendData(ledger, "accepted", write)).toBe(true);
	expect(stored).toBe("accepted");
});

it("an unstarted session preserves the native refusal, and a thrown write releases its flight", () => {
	expect(writeScormSuspendData(null, "value", () => false)).toBe(false);
	const ledger: GroupObjectiveReplayLedger = {};
	expect(() =>
		writeScormSuspendData(ledger, "value", () => {
			throw new Error("storage");
		}),
	).toThrow("storage");
	expect(ledger.suspendWrite).toBeUndefined();
});
