import { expect, it } from "vitest";
import { stripChoiceRecoveryStrings } from "./fixtures/choice-facts";

const notice =
	"This question changed after you answered it, so your earlier answer no longer counts. Select New attempt to answer it again.";
const script = (strings: Record<string, string>) =>
	`<script id="praxity-config" type="application/json">${JSON.stringify({ strings, choiceStateSignatures: { q: "retained" } })}</script>`;

it("frozen document comparisons remove only the pinned recovery strings", () => {
	const body = '<p data-note="choiceNewAttempt">Keep this authored content.</p>';
	expect(
		stripChoiceRecoveryStrings(
			body +
				script({ choiceHistoryNotice: notice, choiceNewAttempt: "New attempt", other: "retained" }),
		),
	).toBe(body + script({ other: "retained" }));
});

it.each([
	["different notice", { choiceHistoryNotice: "Wrong", choiceNewAttempt: "New attempt" }],
	["different action", { choiceHistoryNotice: notice, choiceNewAttempt: "Wrong" }],
	["missing notice", { choiceNewAttempt: "New attempt" }],
	["missing action", { choiceHistoryNotice: notice }],
] as const)("refuses to normalize %s", (_name, strings) => {
	expect(() => stripChoiceRecoveryStrings(script(strings))).toThrow(
		"Unexpected choice recovery strings",
	);
});
