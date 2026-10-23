import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { buildScormPackage } from "../../src/build";
import { loadGrammarFixture } from "../fixtures/load-grammar-fixture";
import { activityCardsFixture } from "./fixtures/activity-cards-fixture";
import { prepareFixtureEnvironment } from "./global-setup";

export default async function setup() {
	if (process.env.PRAXITY_DESIGN_SYSTEM_ENV) return async () => {};
	return prepareFixtureEnvironment(async (directory, manifest, onServerCreated) => {
		const { course, buildOptions, pages } = await loadGrammarFixture();
		const design = course.frontmatter.design;
		if (!design) throw new Error("Missing comprehensive design");
		for (const [palette, colorMode] of [
			["ink", "light"],
			["clay", "dark"],
		] as const) {
			const output = resolve(directory, `comprehensive-${colorMode}`);
			await mkdir(output);
			const result = await buildScormPackage(
				{
					...course,
					frontmatter: {
						...course.frontmatter,
						design: { ...design, palette, colorMode },
					},
				},
				{ ...buildOptions, format: "html" },
			);
			new AdmZip(result.zip).extractAllTo(output, true);
		}
		for (const [locale, dark] of [
			["en", false],
			["en", true],
			["fr", false],
		] as const) {
			const output = resolve(directory, `activity-cards-${locale}-${dark ? "dark" : "light"}`);
			await mkdir(output);
			const result = await buildScormPackage(activityCardsFixture(locale, dark), {
				format: "html",
			});
			new AdmZip(result.zip).extractAllTo(output, true);
		}
		const server = createServer(
			(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
		);
		onServerCreated(server);
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		await writeFile(manifest, JSON.stringify({ url, pages, tmpDir: directory }));
	});
}
