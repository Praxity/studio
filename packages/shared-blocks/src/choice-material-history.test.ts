import { expect, it } from "vitest";
import { choiceDependencyStatus, restoreChoiceAssessmentState } from "./choice-learner-state";
import { materialHistoryCases } from "./fixtures/choice-evidence";

for (const { name, id, view } of materialHistoryCases()) {
	it(`${name} restores as review and is history for every consumer`, () => {
		expect(
			restoreChoiceAssessmentState(view.readState(id), {
				question: view.questions[id],
				signature: view.signatures[id],
			}).status,
		).toBe("review");
		expect(choiceDependencyStatus(id, view)).toBe("history");
	});
}
