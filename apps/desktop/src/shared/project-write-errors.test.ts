import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fr from "@praxity/editor-core/messages/fr" with { type: "json" };
import ts from "typescript";
import { expect, it } from "vitest";
import {
	ProjectPlainStoreError,
	projectIdentityRecoveryAdvice,
	projectIdentityRecoveryMessage,
	projectPlainStoreMessage,
	projectPlainStorePath,
	projectReadErrorKey,
} from "./project-write-errors";

it("preserves French accents in the self-check labels", () => {
	expect(fr.pedagogyAudit.blockTypes.selfCheck).toBe("Autoévaluation");
	expect(fr.blockEditor.selfCheck).toBe("Autoévaluation");
});

it("preserves French accents in both recovery messages", () => {
	const message = projectPlainStoreMessage(".praxity", "fr");
	for (const text of [
		"spéciaux",
		"identités",
		"Vérifiez",
		"inutilisés",
		"Exécutez",
		"Arrêtez-vous",
		"échoue",
		"déplacent",
		"lié",
		"à la copie",
	])
		expect(message).toContain(text);
	const recovery = projectIdentityRecoveryMessage("fr");
	expect(recovery).toContain("octets remplacés");
	expect(recovery).toContain("fichiers nécessaires");
	expect(recovery).toContain("fichiers d'identité");
	expect(message + recovery).not.toMatch(/\p{L}\?\p{L}/u);
});

function damagedWords(text: string): string[] {
	return (
		text
			.replace(/https?:\/\/[^\s"'`<>]+/gu, "")
			.replace(/[^\s"'`<>?]+\.[a-z\d]+\?[^\s"'`<>]*/giu, "")
			.replace(/[^\s"'`<>?]+\?[^\s"'`<>?=]+=[^\s"'`<>]*/gu, "")
			.match(/\p{L}+(?:\?\p{L}+)+/gu) ?? []
	);
}

function damagedSourceWords(text: string, path = "messages.ts"): string[] {
	const words: string[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
			words.push(...damagedWords(node.text));
		}
		ts.forEachChild(node, visit);
	};
	// Parse literals so regex syntax and TypeScript optional markers are not treated as copy.
	visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest));
	return words;
}

it.each([
	["sp?ciaux et identit?s", ["sp?ciaux", "identit?s"]],
	["https://www.youtube.com/watch?v=...", []],
	["Ouvrez index.html?praxity-page=x", []],
	["Ouvrez ./index.html?praxity-page=x#suite", []],
	["Ouvrez /launch?canvas=1", []],
	["repos/owner/repo/actions/runs?head_sha=abc", []],
	["Vérifiez les identités. Continuer ?", []],
] as const)("checks damaged words while preserving URLs and punctuation: %s", (text, expected) => {
	expect(damagedWords(text)).toEqual(expected);
});

it("ignores regex syntax while checking source strings and template spans", () => {
	expect(
		damagedSourceWords(
			'const image = /jpe?g/i; const label = "Pr?c?dent"; const tip = `R?ponse ${count} sp?ciaux`; ',
		),
	).toEqual(["Pr?c?dent", "R?ponse", "sp?ciaux"]);
});

it("has no question marks inside words in French catalogs or message modules", () => {
	const root = resolve(import.meta.dirname, "../../../..");
	const sources = execFileSync("git", ["ls-files", "-z", "--", "apps/", "packages/"], {
		cwd: root,
		encoding: "utf8",
	})
		.split("\0")
		.filter((path) => /\.[cm]?[jt]sx?$|\.json$/.test(path))
		.filter(
			(path) =>
				!/(?:^|\/)(?:__tests__|__fixtures__|tests?|e2e|fixtures)(?:\/|$)|\.(?:test|spec|proof)\.[^/]+$/.test(
					path,
				),
		)
		.map((path) => ({ path, text: readFileSync(resolve(root, path), "utf8") }));
	const paths = sources.map(({ path }) => path);
	expect(paths).toContain("apps/desktop/src/shared/project-write-errors.ts");
	expect(paths).toContain("apps/desktop/src/main/cli-messages/fr.json");
	expect(paths).toContain("packages/editor-core/src/messages/fr.json");
	expect(paths).toContain("apps/desktop/src/shared/canvas-messages.ts");
	expect(paths).toContain("packages/shared-blocks/src/i18n/strings.ts");
	expect(paths).toContain("apps/desktop/src/shared/keyboard-shortcuts.ts");
	expect(paths).toContain("packages/shared-blocks/src/i18n/completion-gate-strings.ts");
	const failures = sources.flatMap(({ path, text }) => {
		const words = damagedSourceWords(text, path);
		return words.length ? [{ path, words }] : [];
	});
	expect(failures).toEqual([]);
});

it("recovery advice recognizes wrapped identity failures and terminates on unrelated cyclic causes", () => {
	const identity = Object.assign(new Error("identity unavailable"), {
		messageRef: { key: "desktop.identity.missingEstablished" },
	});
	const wrapped = new Error("export refused", { cause: identity });
	expect(projectIdentityRecoveryAdvice(wrapped, "fr")).toContain("Restaurez le dossier complet");
	expect(projectIdentityRecoveryAdvice(wrapped, "fr")).toContain("praxity recovery resolve");
	expect(projectIdentityRecoveryAdvice(wrapped, "fr")).toContain(
		"Nouvelle identit\u00e9 volontaire",
	);
	const other = new Error("unrelated");
	other.cause = other;
	expect(projectIdentityRecoveryAdvice(other, "en")).toBeUndefined();
	expect(projectIdentityRecoveryAdvice(null, "en")).toBeUndefined();
});

it("keeps the plain-store key and path through JSON without classifying other identity errors", () => {
	const error = new ProjectPlainStoreError(".praxity");
	expect(projectReadErrorKey(error)).toBe("plainStoreRequired");
	expect(projectPlainStorePath(JSON.parse(JSON.stringify(error)))).toBe(".praxity");
	expect(
		projectReadErrorKey({ code: "EIDENTITY", messageRef: { key: "desktop.identity.invalidFile" } }),
	).toBe("projectReadError");
	expect(
		projectPlainStorePath({
			messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: 17 } },
		}),
	).toBeUndefined();
});

it.each(["en", "fr"] as const)(
	"quotes recovery paths and keeps backups outside lineage, %s",
	(locale) => {
		const message = projectPlainStoreMessage(".praxity/author's record.json", locale);
		expect(message).toContain(`cp -R -L '.praxity/author'"'"'s record.json' '.praxity-plain-copy'`);
		expect(message).toContain(`mv '.praxity/author'"'"'s record.json' '.praxity-linked-backup'`);
		expect(message).toContain(`mv '.praxity-plain-copy' '.praxity/author'"'"'s record.json'`);
		expect(message).toContain(
			"Copy-Item -LiteralPath '.praxity/author''s record.json' -Destination '.praxity-plain-copy' -Recurse -ErrorAction Stop",
		);
		expect(message).not.toContain("{path}");
	},
);
