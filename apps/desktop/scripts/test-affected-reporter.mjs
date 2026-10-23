import { writeFileSync } from "node:fs";

// Vitest's JSON success flag omits unhandled errors. Recovery must retain them,
// along with suite/hook errors that are not attached to a failed test.
export default class AffectedReporter {
	onInit(ctx) {
		this.ctx = ctx;
	}

	onTestRunEnd(modules, errors) {
		const testResults = modules.map((module) => ({
			name: module.moduleId,
			status: module.state(),
			nonTestErrors:
				module.errors().length > 0 ||
				[...module.children.allSuites()].some((suite) => suite.errors().length > 0),
			message: module
				.errors()
				.map((error) => error.message)
				.join("\n"),
			assertionResults: [...module.children.allTests()].map((test) => ({
				status: test.result().state,
				// Vitest's built-in JSON reporter prefers stack over message. Timeout
				// stacks can say STACK_TRACE_ERROR, hiding the actual timeout reason.
				failureMessages:
					test.result().errors?.map((error) => `${error.name}: ${error.message}`) ?? [],
			})),
		}));
		const output = this.ctx.config.outputFile;
		if (typeof output !== "string") throw new Error("Affected reporter requires an output file");
		writeFileSync(
			output,
			JSON.stringify({
				numFailedTests: testResults.reduce(
					(count, file) =>
						count + file.assertionResults.filter((test) => test.status === "failed").length,
					0,
				),
				numUnhandledErrors: errors.length,
				nonTestErrors: testResults.some((file) => file.nonTestErrors),
				testResults,
			}),
		);
	}
}
