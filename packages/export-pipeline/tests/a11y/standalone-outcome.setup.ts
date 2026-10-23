import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import handler from "serve-handler";
import { writeStandaloneOutcomeFixtures } from "./fixtures/standalone-outcome-fixture";
import { prepareFixtureEnvironment } from "./global-setup";

export default async function setup() {
	return prepareFixtureEnvironment(async (directory, manifest, onServerCreated) => {
		await writeStandaloneOutcomeFixtures(directory);
		const server = createServer(
			(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
		);
		onServerCreated(server);
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		await writeFile(
			manifest,
			JSON.stringify({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				pages: [],
				tmpDir: directory,
			}),
		);
	});
}
