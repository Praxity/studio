import { appendFileSync } from "node:fs";
import { browserRequired, candidateDiff } from "./ci-browser.mjs";

let browser = true;
let candidateBase = "";
try {
	browser = browserRequired(
		JSON.parse(process.env.BROWSER_SKIP),
		process.argv.includes("--candidate")
			? () =>
					candidateDiff(undefined, (sha) => {
						candidateBase = sha;
					})
			: undefined,
	);
} catch (error) {
	console.warn(`Browser skip-list unavailable; running all suites: ${error.message}`);
}
appendFileSync(process.env.GITHUB_OUTPUT, `browser=${browser}\n`);
if (process.argv.includes("--candidate"))
	appendFileSync(process.env.GITHUB_OUTPUT, `candidate_base=${candidateBase}\n`);
