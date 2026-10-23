import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { buildScormPackage } from "../../src/build";
import { loadGrammarFixture } from "../fixtures/load-grammar-fixture";
import { containerLayoutsFixture } from "./fixtures/container-layouts-fixture";
import { designContainerSurfaceFixtures } from "./fixtures/design-container-surfaces-fixture";
import { prepareFixtureEnvironment } from "./global-setup";

export default async function setup() {
	return prepareFixtureEnvironment(async (directory, manifest, onServerCreated) => {
		const { course, buildOptions } = await loadGrammarFixture();
		const design = course.frontmatter.design;
		if (!design) throw new Error("The comprehensive fixture must define its design");
		const inventories: Record<string, Array<{ slug: string; title: string }>> = {};
		for (const [palette, colorMode] of [
			["ink", "light"],
			["clay", "dark"],
		] as const) {
			const name = `${palette}-${colorMode}`;
			const output = resolve(directory, name);
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
			for (const file of await readdir(output)) {
				if (file.endsWith(".css"))
					console.log(
						`${name} ${file} gzip ${gzipSync(await readFile(resolve(output, file))).byteLength}`,
					);
				if (!file.endsWith(".html")) continue;
				const html = await readFile(resolve(output, file), "utf8");
				const config = html.match(
					/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
				);
				if (config) inventories[name] = JSON.parse(config[1]).pages;
			}
		}
		// Keep this block suite independent of unrelated deck and authoring fixtures.
		for (const { route, course: fixture } of [
			containerLayoutsFixture(),
			...designContainerSurfaceFixtures(),
		]) {
			const result = await buildScormPackage(fixture, { ...buildOptions, format: "html" });
			new AdmZip(result.zip).extractAllTo(resolve(directory, route), true);
		}
		const server = createServer((request, response) => {
			// Reproduce a learner's CSP-blocked third-party embed deterministically.
			response.setHeader(
				"Content-Security-Policy",
				"frame-src 'self'; img-src 'self' data: https://i.ytimg.com",
			);
			void handler(request, response, { public: directory, cleanUrls: false });
		});
		onServerCreated(server);
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		await writeFile(
			manifest,
			JSON.stringify({
				url,
				tmpDir: directory,
				pages: inventories["ink-light"],
				fullFixtureVariants: {
					"theme-light": `${url}/ink-light`,
					"theme-dark": `${url}/clay-dark`,
				},
				coursePages: Object.fromEntries(
					Object.entries(inventories).map(([name, pages]) => [`${url}/${name}`, pages]),
				),
			}),
		);
	});
}
