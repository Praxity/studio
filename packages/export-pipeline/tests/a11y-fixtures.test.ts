import { access, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { prepareFixtureEnvironment, stubFixtureDownloads } from "./a11y/global-setup";
import { silentWav } from "./fixtures/silent-audio";

test("fixture builds reject unexpected remote fetches without contacting the network", async () => {
	const previousFetch = globalThis.fetch;
	let networkRequests = 0;
	globalThis.fetch = async () => {
		networkRequests++;
		return new Response("unexpected network");
	};
	const restore = stubFixtureDownloads();
	try {
		await expect(fetch(new Request("https://unexpected.example/asset.mp3"))).rejects.toThrow(
			/Unexpected fixture download/,
		);
		expect(networkRequests).toBe(0);
	} finally {
		restore();
		globalThis.fetch = previousFetch;
	}
});

test.each(["https://example.com/test-image.webp", "https://deck.example/slide.webp"])(
	"fixture download serves %s locally and restores the caller's fetch",
	async (url) => {
		const previousFetch = globalThis.fetch;
		const restore = stubFixtureDownloads();
		try {
			const response = await fetch(url);
			expect(response.headers.get("content-type")).toBe("image/webp");
			expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
		} finally {
			restore();
		}
		expect(globalThis.fetch).toBe(previousFetch);
	},
);

test("local silence is a 60-second mono PCM clip with a valid RIFF length", () => {
	const audio = silentWav(60);
	expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
	expect(audio.readUInt32LE(4)).toBe(audio.length - 8);
	expect(audio.readUInt16LE(22)).toBe(1);
	expect(audio.readUInt32LE(24)).toBe(8_000);
	expect(audio.readUInt16LE(34)).toBe(16);
	expect(audio.readUInt32LE(40)).toBe(60 * 8_000 * 2);
	expect(audio.subarray(44).every((byte) => byte === 0)).toBe(true);
	expect(() => silentWav(0)).toThrow(/positive integer/);
});

test("failed fixture preparation closes its server, removes partial output and preserves the original error", async () => {
	const previousFetch = globalThis.fetch;
	const previousPath = process.env.PRAXITY_A11Y_ENV_PATH;
	const originalError = new Error("fixture compilation failed");
	const server = createServer();
	let directory = "";
	await expect(
		prepareFixtureEnvironment(async (output, manifest, created) => {
			directory = output;
			await writeFile(manifest, "partial output");
			created(server);
			await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
			throw originalError;
		}),
	).rejects.toBe(originalError);
	expect(server.listening).toBe(false);
	await expect(access(directory)).rejects.toThrow();
	expect(globalThis.fetch).toBe(previousFetch);
	expect(process.env.PRAXITY_A11Y_ENV_PATH).toBe(previousPath);
});

test("cleanup failure still restores the manifest and fetch and reports both errors", async () => {
	const previousFetch = globalThis.fetch;
	const previousPath = process.env.PRAXITY_A11Y_ENV_PATH;
	const original = new Error("prepare failed");
	const cleanup = new Error("remove failed");
	let directory = "";
	try {
		await expect(
			prepareFixtureEnvironment(
				async (output) => {
					directory = output;
					throw original;
				},
				async () => {
					throw cleanup;
				},
			),
		).rejects.toMatchObject({ errors: [original, cleanup] });
		expect(globalThis.fetch).toBe(previousFetch);
		expect(process.env.PRAXITY_A11Y_ENV_PATH).toBe(previousPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
