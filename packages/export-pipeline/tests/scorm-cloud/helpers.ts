import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RegistrationProgress, ScormCloudClient } from "../../src/scorm-cloud/client";

export interface ScormCloudTestEnv {
	skip?: boolean;
	reason?: string;
	scorm12CourseId?: string;
	scorm2004CourseId?: string;
	pageCount?: number;
	scoredQuestionCount?: number;
}

export const TEST_ENV_PATH = resolve(import.meta.dirname, ".test-env.json");

export function readTestEnv(): ScormCloudTestEnv {
	try {
		const raw = readFileSync(TEST_ENV_PATH, "utf-8");
		return JSON.parse(raw) as ScormCloudTestEnv;
	} catch {
		return { skip: true, reason: "No .test-env.json found — global setup may have failed" };
	}
}

export async function waitForProgress(
	client: ScormCloudClient,
	regId: string,
	predicate: (p: RegistrationProgress) => boolean,
	opts?: { maxAttempts?: number; initialDelayMs?: number },
): Promise<RegistrationProgress> {
	const maxAttempts = opts?.maxAttempts ?? 20;
	let delayMs = opts?.initialDelayMs ?? 3000;
	let lastProgress: RegistrationProgress | undefined;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
		lastProgress = await client.getProgress(regId, { includeRuntime: true });

		if (predicate(lastProgress)) {
			return lastProgress;
		}

		delayMs = Math.min(delayMs * 1.5, 8000);
	}

	throw new Error(
		`waitForProgress: predicate not satisfied after ${maxAttempts} attempts. ` +
			`Last progress: ${JSON.stringify(lastProgress, null, 2)}`,
	);
}
