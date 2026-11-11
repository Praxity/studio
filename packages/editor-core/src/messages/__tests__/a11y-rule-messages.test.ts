import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import { RULE_METADATA } from "../../lib/a11y/rule-metadata";
import en from "../en.json";
import fr from "../fr.json";

describe("accessibility rule messages", () => {
	it("keeps the English and French rule catalogs aligned", () => {
		expect(Object.keys(fr.a11yAudit.rules).sort()).toEqual(Object.keys(en.a11yAudit.rules).sort());
	});

	it.each([
		["en", en],
		["fr", fr],
	] as const)("gives every %s rule a specific action", (_locale, messages) => {
		const vaguePhrases = [
			"Update this item",
			"Add the missing content",
			"Reduce this to a manageable amount",
			"Mettez à jour cet élément",
			"Ajoutez le contenu manquant",
			"Réduisez ce montant",
		];

		for (const [rule, message] of Object.entries(messages.a11yAudit.rules)) {
			// Source diagnostic rules reuse the owning grammar catalogue, as Check does.
			const description =
				"description" in message
					? message.description
					: messages.op.diagnostic[rule as keyof typeof messages.op.diagnostic];
			expect(description, rule).toBeTruthy();
			expect(description.trim(), rule).not.toBe("");
			for (const phrase of vaguePhrases) {
				expect(description, rule).not.toContain(phrase);
			}
		}
	});

	it.each(["card-both-sides", "theme-warning-on-background-contrast", "completion-gate-reason"])(
		"covers the checker rule %s in messages and metadata",
		(rule) => {
			expect(en.a11yAudit.rules).toHaveProperty(rule);
			expect(fr.a11yAudit.rules).toHaveProperty(rule);
			expect(RULE_METADATA).toHaveProperty(rule);
		},
	);

	it("names the undefined abbreviation in both locales", () => {
		for (const [locale, messages] of [
			["en", en],
			["fr", fr],
		] as const) {
			const t = createTranslator({
				locale,
				messages: messages as Record<string, unknown>,
				namespace: "a11yAudit",
			});
			expect(t("rules.abbreviation-undefined.description", { abbreviation: "WCAG" })).toContain(
				"WCAG",
			);
		}
	});
});
