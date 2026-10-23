import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NARRATION_METADATA_VERSION, NARRATION_RECIPE, SONIOX_MODEL } from "../../shared/narration";
import { generateSonioxNarration, getSonioxVoices, writeGeneratedNarration } from "../narration";

const request = {
	requestId: "request-1",
	originalScript: "Hi.",
	language: "en" as const,
	voice: "Maya",
	speed: 1,
	lexemes: [],
	segmentId: "welcome:title",
};

function fetchMock(body: unknown) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

function socketWith(messages: Record<string, unknown>[], sent: Record<string, unknown>[] = []) {
	return class FakeSocket {
		private listeners = new Map<string, Array<(event: { data?: string }) => void>>();
		constructor(_url: string) {
			queueMicrotask(() => this.emit("open", {}));
		}
		addEventListener(name: string, callback: (event: { data?: string }) => void) {
			this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
		}
		send(value: string) {
			sent.push(JSON.parse(value));
			if (JSON.parse(value).text_end === true) {
				for (const message of messages)
					queueMicrotask(() => this.emit("message", { data: JSON.stringify(message) }));
			}
		}
		close() {}
		private emit(name: string, event: { data?: string }) {
			for (const callback of this.listeners.get(name) ?? []) callback(event);
		}
	};
}

describe("Soniox narration boundary", () => {
	it("pins the required model when loading voices", async () => {
		const voices = await getSonioxVoices(
			"account-key",
			"eu",
			fetchMock({
				models: [
					{
						id: SONIOX_MODEL,
						languages: [{ code: "en" }, { code: "fr" }],
						voices: [{ id: "Maya", description: "Warm", gender: "female" }],
					},
				],
			}) as never,
		);
		expect(voices).toEqual([
			{ id: "Maya", description: "Warm", gender: "female", languages: ["en", "fr"] },
		]);
	});

	it("explains rejected API keys and region mismatches", async () => {
		const unauthorized = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
		await expect(getSonioxVoices("bad-key", "eu", unauthorized as never)).rejects.toThrow(
			/Check that the key is active and the selected data region matches its project/u,
		);
	});

	it("accepts audio only after audio_end, terminated, and complete timestamps", async () => {
		const characters = [...request.originalScript];
		const generated = await generateSonioxNarration(
			request,
			"account-key",
			new AbortController().signal,
			"eu",
			fetchMock({ api_key: "temporary-key" }) as never,
			socketWith([
				{
					audio: Buffer.from("ID3audio").toString("base64"),
					audio_end: true,
					timestamps: {
						characters,
						character_start_times_seconds: [0, 0.1, 0.2],
						character_end_times_seconds: [0.1, 0.2, 0.3],
					},
				},
				{ terminated: true },
			]) as never,
		);
		expect(new TextDecoder().decode(generated.audio)).toBe("ID3audio");
		expect(generated.vtt).toContain("Hi.");
		const assetsDir = await mkdtemp(join(tmpdir(), "praxity-narration-pair-"));
		try {
			const saved = await writeGeneratedNarration(assetsDir, request, generated, assetsDir);
			const audio = join(assetsDir, "narration", saved.narrationAudio.split("/").at(-1) as string);
			await writeFile(audio, "ID3outside authored audio");
			await expect(
				writeGeneratedNarration(assetsDir, request, generated, assetsDir),
			).rejects.toThrow(/collision/i);
			expect(await readFile(audio, "utf8")).toBe("ID3outside authored audio");
		} finally {
			await rm(assetsDir, { recursive: true, force: true });
		}
	});

	it("sends escaped delivery cues as spoken words with aligned captions", async () => {
		const text = "Use warm as literal text.";
		const characters = [...text];
		const sent: Record<string, unknown>[] = [];
		const generated = await generateSonioxNarration(
			{ ...request, originalScript: String.raw`Use \[warm] as literal text.` },
			"account-key",
			new AbortController().signal,
			"eu",
			fetchMock({ api_key: "temporary-key" }) as never,
			socketWith(
				[
					{
						audio: Buffer.from("ID3audio").toString("base64"),
						audio_end: true,
						timestamps: {
							characters,
							character_start_times_seconds: characters.map((_, index) => index / 10),
							character_end_times_seconds: characters.map((_, index) => (index + 1) / 10),
						},
					},
					{ terminated: true },
				],
				sent,
			) as never,
		);
		expect(sent.find((message) => "text" in message)?.text).toBe(text);
		expect(generated.vtt).toContain(text);
	});

	it("fails closed when completion or full-text timing is missing", async () => {
		const run = (messages: Record<string, unknown>[]) =>
			generateSonioxNarration(
				request,
				"account-key",
				new AbortController().signal,
				"eu",
				fetchMock({ api_key: "temporary-key" }) as never,
				socketWith(messages) as never,
			);
		await expect(run([{ audio: "SUQzYXVkaW8=", terminated: true }])).rejects.toThrow(
			/before audio was complete/u,
		);
		await expect(
			run([
				{
					audio: "SUQzYXVkaW8=",
					audio_end: true,
					timestamps: {
						characters: ["H"],
						character_start_times_seconds: [0],
						character_end_times_seconds: [0.1],
					},
				},
				{ terminated: true },
			]),
		).rejects.toThrow(/complete synthesis text/u);
	});

	it("rejects truncated audio when Soniox reaches its two-minute stream limit", async () => {
		await expect(
			generateSonioxNarration(
				request,
				"account-key",
				new AbortController().signal,
				"eu",
				fetchMock({ api_key: "temporary-key" }) as never,
				socketWith([
					{ audio: Buffer.from("ID3partial").toString("base64") },
					{ error_type: "max_audio_duration_reached", error_code: 413 },
					{ terminated: true },
				]) as never,
			),
		).rejects.toThrow("max_audio_duration_reached");
	});

	it("does not create a partial pair when a content-addressed target collides", async () => {
		const assetsDir = await mkdtemp(join(tmpdir(), "praxity-narration-"));
		const scriptHash = "a".repeat(64);
		const lexiconHash = "b".repeat(64);
		const contentHash = createHash("sha256")
			.update(
				[SONIOX_MODEL, NARRATION_RECIPE, scriptHash, lexiconHash, "en", "Maya", "1"].join("\0"),
			)
			.digest("hex")
			.slice(0, 12);
		const narrationDir = join(assetsDir, "narration");
		const audioPath = join(narrationDir, `narration-${contentHash}.mp3`);
		const captionsPath = join(narrationDir, `narration-${contentHash}.vtt`);
		try {
			await mkdir(narrationDir);
			await mkdir(captionsPath);
			const vtt = `WEBVTT

NOTE praxity-narration
provider=soniox
model=${SONIOX_MODEL}
language=en
voice=Maya
speed=1
scriptHash=${scriptHash}
lexiconHash=${lexiconHash}
recipeHash=${createHash("sha256").update(NARRATION_RECIPE).digest("hex")}
version=${NARRATION_METADATA_VERSION}
`;
			await expect(
				writeGeneratedNarration(
					assetsDir,
					request,
					{
						audio: new TextEncoder().encode("ID3audio"),
						vtt,
						durationSeconds: 1,
						scriptHash,
						lexiconHash,
					},
					assetsDir,
				),
			).rejects.toBeTruthy();
			await expect(access(audioPath)).rejects.toBeTruthy();
		} finally {
			await rm(assetsDir, { recursive: true, force: true });
		}
	});
});

it("sends formatted narration as paragraph text with original caption words and stable provenance", async () => {
	const sent: Record<string, unknown>[] = [];
	const originalScript =
		"# AI guide\n\nRead **bold** and *italic*.\n\n- First item\n- [warm] Second item";
	const spoken = "AI guide\n\nRead bold and italic.\n\nFirst item\n\n[warm] Second item";
	const synthesis = spoken.replace("AI", "A I");
	const characters = [...synthesis];
	const generated = await generateSonioxNarration(
		{ ...request, originalScript, lexemes: [{ grapheme: "AI", alias: "A I", lang: "en" }] },
		"account-key",
		new AbortController().signal,
		"eu",
		fetchMock({ api_key: "temporary-key" }) as never,
		socketWith(
			[
				{
					audio: Buffer.from("ID3audio").toString("base64"),
					audio_end: true,
					timestamps: {
						characters,
						character_start_times_seconds: characters.map((_, i) => i / 10),
						character_end_times_seconds: characters.map((_, i) => (i + 1) / 10),
					},
				},
				{ terminated: true },
			],
			sent,
		) as never,
	);
	expect(
		sent
			.filter((message) => typeof message.text === "string")
			.map((message) => message.text)
			.join(""),
	).toBe(synthesis);
	expect(generated.scriptHash).toBe(
		createHash("sha256").update(spoken.replace(/\s+/gu, " ")).digest("hex"),
	);
	expect(generated.vtt).toContain("AI guide");
	expect(generated.vtt).toContain("Read bold and italic.");
	expect(generated.vtt).toContain("First item");
	expect(generated.vtt).not.toContain("[warm]");
	expect(generated.vtt).not.toContain("A I guide");
	expect(generated.vtt).not.toContain("**");
});
