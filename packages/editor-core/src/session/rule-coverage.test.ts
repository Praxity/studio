// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import coverage from "./rule-coverage.json";

function testRules(): Set<string> {
	const rules = new Set<string>();
	const directory = fileURLToPath(new URL(".", import.meta.url));
	for (const file of readdirSync(directory).filter(
		(file) => file.endsWith(".test.ts") && file !== "rule-coverage.test.ts",
	)) {
		const source = ts.createSourceFile(
			file,
			readFileSync(`${directory}/${file}`, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		const visit = (node: ts.Node) => {
			if (ts.isCallExpression(node) && /^it(?:\.|\(|$)/u.test(node.expression.getText(source))) {
				const title = node.arguments[0];
				if (title && ts.isStringLiteral(title))
					for (const match of title.text.matchAll(/\b([A-Z]\d+)\b/gu)) rules.add(match[1]);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return rules;
}
function uncovered(
	ids: readonly string[],
	tested: Set<string>,
	deferred: Record<string, string>,
): string[] {
	return ids.filter((id) => !tested.has(id) && !deferred[id]?.trim());
}

it("every interaction-rule ID has a public-interface test or an explicit owner and deferral reason", () => {
	// Use the pinned inventory unless an explicit spec path is supplied.
	const path = process.env.PRAXITY_INTERACTION_RULES;
	const ids = path
		? [
				...new Set(
					[...readFileSync(path, "utf8").matchAll(/\*\*([A-Z]\d+)\.\*\*/gu)].map(
						(match) => match[1],
					),
				),
			]
		: coverage.ids;
	expect(ids.length).toBeGreaterThan(100);
	expect([...ids].sort()).toEqual([...coverage.ids].sort());
	const tested = testRules();
	expect(uncovered(ids, tested, coverage.deferrals)).toEqual([]);
	for (const reason of Object.values(coverage.deferrals))
		expect(reason.trim().length).toBeGreaterThan(30);
	for (const id of [
		...Array.from({ length: 9 }, (_, i) => `M${i + 1}`),
		// Owner 2026-10-14: D16 covers per-save/discard undo; session grouping waits for U7 slice 04a.
		...Array.from({ length: 17 }, (_, i) => `D${i + 1}`),
		...Array.from({ length: 8 }, (_, i) => `A${i + 1}`),
		...Array.from({ length: 11 }, (_, i) => `G${i + 1}`),
		"F8",
	])
		expect(tested.has(id), id).toBe(true);
});

it("coverage fails closed for a newly introduced rule and an empty deferral", () => {
	expect(uncovered(["M999"], new Set(), {})).toEqual(["M999"]);
	expect(uncovered(["M999"], new Set(), { M999: " " })).toEqual(["M999"]);
});

it("session source remains free of framework, DOM, transport and UI announcement owners", () => {
	const directory = fileURLToPath(new URL(".", import.meta.url));
	for (const file of readdirSync(directory).filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
	)) {
		const text = readFileSync(`${directory}/${file}`, "utf8");
		expect(text, file).not.toMatch(/from ["'](?:react|react-dom|node:|.*rpc|.*LiveRegion)/u);
		expect(text, file).not.toMatch(/\b(?:document|window|fetch|HTMLElement)\b/u);
	}
});
