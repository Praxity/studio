import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { narrationScriptText, validateNarrationCues } from "@praxity/shared-blocks/narration";
import type {
	NarrationSynthesisRequest,
	NarrationSynthesisResult,
	NarrationVoice,
	SonioxRegion,
} from "../shared/bridge";
import {
	buildNarrationVtt,
	expandPronunciation,
	lexiconFingerprint,
	NARRATION_METADATA_VERSION,
	NARRATION_RECIPE,
	normalizeNarrationScript,
	parseNarrationProvenance,
	SONIOX_MODEL,
} from "../shared/narration";
import { readFileWithin, resolveWritablePathWithin } from "./path-security";
import { applyProjectFilePlan, withProjectFileTransaction } from "./project-file-transactions";

const SONIOX_ENDPOINTS: Record<SonioxRegion, { api: string; tts: string }> = {
	eu: { api: "https://api.eu.soniox.com/v1", tts: "wss://tts-rt.eu.soniox.com/tts-websocket" },
	us: { api: "https://api.soniox.com/v1", tts: "wss://tts-rt.soniox.com/tts-websocket" },
	jp: { api: "https://api.jp.soniox.com/v1", tts: "wss://tts-rt.jp.soniox.com/tts-websocket" },
};
const MAX_AUDIO_BYTES = 12_000_000;

type Fetch = typeof fetch;
type Socket = Pick<WebSocket, "addEventListener" | "close" | "send">;
type SocketConstructor = new (url: string) => Socket;

interface SonioxAudio {
	audio: Uint8Array;
	characters: string[];
	startTimes: number[];
	endTimes: number[];
}

function hash(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function isMp3(bytes: Uint8Array): boolean {
	return (
		Buffer.from(bytes.subarray(0, 3)).toString("ascii") === "ID3" ||
		(bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0)
	);
}

async function jsonRequest<T>(
	path: string,
	apiKey: string,
	region: SonioxRegion,
	init: RequestInit,
	fetchImpl: Fetch,
): Promise<T> {
	const response = await fetchImpl(`${SONIOX_ENDPOINTS[region].api}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	if (response.status === 401) {
		throw new Error(
			"Soniox rejected this API key. Check that the key is active and the selected data region matches its project.",
		);
	}
	if (!response.ok) throw new Error(`Narration provider request failed (${response.status}).`);
	return (await response.json()) as T;
}

export async function getSonioxVoices(
	apiKey: string,
	region: SonioxRegion = "eu",
	fetchImpl: Fetch = fetch,
): Promise<NarrationVoice[]> {
	const response = await jsonRequest<{
		models?: Array<{
			id?: unknown;
			languages?: Array<{ code?: unknown }>;
			voices?: Array<{ id?: unknown; description?: unknown; gender?: unknown }>;
		}>;
	}>("/tts-models", apiKey, region, { method: "GET" }, fetchImpl);
	const model = response.models?.find((candidate) => candidate.id === SONIOX_MODEL);
	if (!model) throw new Error("The required narration model is unavailable.");
	const languages = (model.languages ?? [])
		.map((language) => language.code)
		.filter((code): code is string => typeof code === "string");
	return (model.voices ?? []).flatMap((voice) =>
		typeof voice.id === "string" &&
		/^\w[\w-]{0,49}$/u.test(voice.id) &&
		typeof voice.description === "string"
			? [
					{
						id: voice.id,
						description: voice.description,
						gender: typeof voice.gender === "string" ? voice.gender : undefined,
						languages,
					},
				]
			: [],
	);
}

async function temporaryApiKey(
	apiKey: string,
	region: SonioxRegion,
	fetchImpl: Fetch,
	signal: AbortSignal,
): Promise<string> {
	const result = await jsonRequest<{ api_key?: unknown }>(
		"/auth/temporary-api-key",
		apiKey,
		region,
		{
			method: "POST",
			signal,
			body: JSON.stringify({
				usage_type: "tts_rt",
				expires_in_seconds: 300,
				max_session_duration_seconds: 150,
				single_use: true,
			}),
		},
		fetchImpl,
	);
	if (typeof result.api_key !== "string" || !result.api_key) {
		throw new Error("The narration provider returned an invalid temporary credential.");
	}
	return result.api_key;
}

function parseSocketMessage(data: unknown): Record<string, unknown> {
	if (typeof data !== "string") throw new Error("Narration provider sent an invalid response.");
	const parsed: unknown = JSON.parse(data);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Narration provider sent an invalid response.");
	}
	return parsed as Record<string, unknown>;
}

async function streamSoniox(
	apiKey: string,
	region: SonioxRegion,
	text: string,
	language: string,
	voice: string,
	speed: number,
	returnTimestamps: boolean,
	signal: AbortSignal,
	fetchImpl: Fetch,
	SocketImpl: SocketConstructor,
): Promise<SonioxAudio> {
	let temporaryKey: string;
	try {
		temporaryKey = await temporaryApiKey(apiKey, region, fetchImpl, signal);
	} catch (error) {
		if (signal.aborted) throw new Error("Narration generation cancelled.");
		throw error;
	}
	if (signal.aborted) throw new Error("Narration generation cancelled.");
	const streamId = `praxity-${randomUUID()}`;

	return new Promise((resolve, reject) => {
		const socket = new SocketImpl(SONIOX_ENDPOINTS[region].tts);
		const audio: Uint8Array[] = [];
		const characters: string[] = [];
		const startTimes: number[] = [];
		const endTimes: number[] = [];
		let audioBytes = 0;
		let audioEnd = false;
		let settled = false;
		let errorType: string | null = null;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener("abort", cancel);
			socket.close();
			if (error) reject(error);
			else
				resolve({
					audio: new Uint8Array(Buffer.concat(audio.map((chunk) => Buffer.from(chunk)))),
					characters,
					startTimes,
					endTimes,
				});
		};
		const cancel = () => {
			try {
				socket.send(JSON.stringify({ stream_id: streamId, cancel: true }));
			} catch {}
			finish(new Error("Narration generation cancelled."));
		};
		const timeout = setTimeout(() => finish(new Error("Narration generation timed out.")), 150_000);
		signal.addEventListener("abort", cancel, { once: true });

		socket.addEventListener("open", () => {
			socket.send(
				JSON.stringify({
					api_key: temporaryKey,
					model: SONIOX_MODEL,
					language,
					voice,
					audio_format: "mp3",
					bitrate: 64_000,
					return_timestamps: returnTimestamps,
					speed,
					stream_id: streamId,
				}),
			);
			socket.send(JSON.stringify({ text, text_end: true, stream_id: streamId }));
		});
		socket.addEventListener("message", (event) => {
			try {
				const message = parseSocketMessage((event as MessageEvent).data);
				if (message.stream_id !== undefined && message.stream_id !== streamId) return;
				if (typeof message.error_type === "string") {
					errorType = /^\w[\w-]{0,99}$/u.test(message.error_type)
						? message.error_type
						: "provider_error";
				}
				if (typeof message.audio === "string") {
					if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(message.audio)) {
						throw new Error("Narration provider sent invalid audio data.");
					}
					const chunk = Buffer.from(message.audio, "base64");
					audioBytes += chunk.byteLength;
					if (audioBytes > MAX_AUDIO_BYTES)
						throw new Error("Generated narration exceeded the size limit.");
					audio.push(new Uint8Array(chunk));
				}
				const timestamps = message.timestamps;
				if (timestamps && typeof timestamps === "object" && !Array.isArray(timestamps)) {
					const values = timestamps as Record<string, unknown>;
					if (
						!Array.isArray(values.characters) ||
						!Array.isArray(values.character_start_times_seconds) ||
						!Array.isArray(values.character_end_times_seconds) ||
						!values.characters.every((value) => typeof value === "string") ||
						!values.character_start_times_seconds.every((value) => typeof value === "number") ||
						!values.character_end_times_seconds.every((value) => typeof value === "number")
					) {
						throw new Error("Narration timing data was malformed.");
					}
					characters.push(...(values.characters as string[]));
					startTimes.push(...(values.character_start_times_seconds as number[]));
					endTimes.push(...(values.character_end_times_seconds as number[]));
				}
				if (message.audio_end === true) audioEnd = true;
				if (message.terminated === true) {
					if (errorType) finish(new Error(`Narration generation failed (${errorType}).`));
					else if (!audioEnd || audioBytes === 0)
						finish(new Error("Narration generation ended before audio was complete."));
					else finish();
				}
			} catch (error) {
				finish(
					error instanceof Error
						? error
						: new Error("Narration provider sent an invalid response."),
				);
			}
		});
		socket.addEventListener("error", () =>
			finish(new Error("Could not connect to the narration provider.")),
		);
		socket.addEventListener("close", () => {
			if (!settled) finish(new Error("Narration provider disconnected before completion."));
		});
	});
}

export async function generateSonioxNarration(
	request: NarrationSynthesisRequest,
	apiKey: string,
	signal: AbortSignal,
	region: SonioxRegion = "eu",
	fetchImpl: Fetch = fetch,
	SocketImpl: SocketConstructor = WebSocket,
): Promise<{
	audio: Uint8Array;
	vtt: string;
	durationSeconds: number;
	scriptHash: string;
	lexiconHash: string;
}> {
	const originalScript = narrationScriptText(request.originalScript);
	const invalidCues = validateNarrationCues(originalScript);
	if (invalidCues.length > 0) {
		throw new Error(`Unsupported narration cue: ${invalidCues.join(", ")}.`);
	}
	const expanded = expandPronunciation(request.originalScript, request.lexemes, request.language);
	if (!expanded.synthesisText || expanded.synthesisText.length > 5_000) {
		throw new Error(
			"Narration text must contain no more than 5,000 characters after pronunciation expansion.",
		);
	}
	const scriptHash = hash(normalizeNarrationScript(originalScript));
	const lexiconHash = hash(lexiconFingerprint(expanded.matches));
	const recipeHash = hash(NARRATION_RECIPE);
	const streamed = await streamSoniox(
		apiKey,
		region,
		expanded.synthesisText,
		request.language,
		request.voice,
		request.speed,
		true,
		signal,
		fetchImpl,
		SocketImpl,
	);
	if (!isMp3(streamed.audio)) throw new Error("Narration provider returned invalid MP3 audio.");
	const captions = buildNarrationVtt(
		expanded,
		streamed.characters,
		streamed.startTimes,
		streamed.endTimes,
		{
			provider: "soniox",
			model: SONIOX_MODEL,
			language: request.language,
			voice: request.voice,
			speed: request.speed,
			scriptHash,
			lexiconHash,
			recipeHash,
			version: NARRATION_METADATA_VERSION,
		},
	);
	if (captions.durationSeconds >= 120) {
		throw new Error("Narration reached the two-minute generation limit and was not saved.");
	}
	return {
		audio: streamed.audio,
		vtt: captions.vtt,
		durationSeconds: captions.durationSeconds,
		scriptHash,
		lexiconHash,
	};
}

export async function writeGeneratedNarration(
	assetsDir: string,
	request: NarrationSynthesisRequest,
	generated: Awaited<ReturnType<typeof generateSonioxNarration>>,
	projectDir: string,
): Promise<NarrationSynthesisResult> {
	if (!isMp3(generated.audio) || !parseNarrationProvenance(generated.vtt)) {
		throw new Error("Generated narration assets failed validation.");
	}
	const contentHash = hash(
		[
			SONIOX_MODEL,
			NARRATION_RECIPE,
			generated.scriptHash,
			generated.lexiconHash,
			request.language,
			request.voice,
			request.speed,
		].join("\0"),
	).slice(0, 12);
	const base = `narration-${contentHash}`;
	const audioName = `${base}.mp3`,
		captionsName = `${base}.vtt`;
	await withProjectFileTransaction(
		projectDir,
		async (root) => {
			const narrationDir = await resolveWritablePathWithin(root, join(assetsDir, "narration"));
			await mkdir(narrationDir, { recursive: true });
			const paths = [join(narrationDir, audioName), join(narrationDir, captionsName)];
			const bytes = [Buffer.from(generated.audio), Buffer.from(generated.vtt)];
			const existing = await Promise.all(
				paths.map(async (path) => {
					try {
						return (await readFileWithin(root, path)) as Buffer;
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
						return null;
					}
				}),
			);
			if (existing.every((entry, index) => entry?.equals(bytes[index]))) return;
			if (existing.some((entry) => entry !== null))
				throw new Error("Narration asset path collision.");
			await applyProjectFilePlan(
				root,
				paths.map((path, index) => ({
					path: relative(root, path).replaceAll("\\", "/"),
					content: bytes[index],
					expectedContent: null,
					head: index === 1,
				})),
			);
		},
		"write",
	);
	return {
		narrationAudio: `assets/narration/${audioName}`,
		narrationTimings: `assets/narration/${captionsName}`,
		durationSeconds: generated.durationSeconds,
		scriptHash: generated.scriptHash,
		lexiconHash: generated.lexiconHash,
		voice: request.voice,
		language: request.language,
	};
}
