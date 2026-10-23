import { JsonReporter } from "vitest/reporters";
import { assertConfirmationTargets, testNameParts } from "./confirm-slow-tests.mjs";

// Vitest's JSON reporter omits unhandled errors, which can coexist with test failures.
export default class ConfirmationJsonReporter extends JsonReporter {
	constructor() {
		super({});
	}

	onTestRunEnd(testModules, unhandledErrors) {
		this.unhandledErrors = unhandledErrors;
		this.diagnostics = new Map(
			testModules.flatMap((module) =>
				[...module.children.allTests()].map((test) => [
					JSON.stringify([module.moduleId, ...testNameParts(test)]),
					test.diagnostic(),
				]),
			),
		);
		return super.onTestRunEnd(testModules);
	}

	writeReport(report) {
		const result = JSON.parse(report);
		for (const file of result.testResults) {
			for (const assertion of file.assertionResults) {
				const diagnostic = this.diagnostics.get(
					JSON.stringify([file.name, ...assertion.ancestorTitles, assertion.title]),
				);
				assertion.retryCount = diagnostic?.retryCount;
				assertion.repeatCount = diagnostic?.repeatCount;
			}
		}
		const selectionErrors = [];
		try {
			assertConfirmationTargets(
				result.testResults.flatMap((file) => file.assertionResults),
				JSON.parse(process.env.SLOW_TESTS_CONFIRMATION_TARGETS),
			);
		} catch (error) {
			selectionErrors.push(error.message);
			process.exitCode = 1;
		}
		return super.writeReport(
			JSON.stringify({ ...result, unhandledErrors: this.unhandledErrors, selectionErrors }),
		);
	}
}
