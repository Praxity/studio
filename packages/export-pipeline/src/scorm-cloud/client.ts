const BASE_URL = "https://cloud.scorm.com/api/v2";

// --- Types ---

export interface PollOptions {
	maxAttempts?: number;
	intervalMs?: number;
}

export interface ProgressOptions {
	includeRuntime?: boolean;
	includeInteractionsAndObjectives?: boolean;
}

export interface LaunchOptions {
	redirectOnExitUrl: string;
	expiry?: number;
	additionalValues?: Array<{ item: string; value: string }>;
}

export type ImportStatus = "RUNNING" | "COMPLETE" | "ERROR";

export interface ImportResult {
	jobId: string;
	status: ImportStatus;
	message: string;
	parserWarnings: string[];
	courseId: string;
	webPathToCourse: string;
}

export interface CourseInfo {
	id: string;
	title: string;
	courseLearningStandard: string;
	registrationCount: number;
	version: number;
}

export interface RegistrationProgress {
	registrationCompletion: "UNKNOWN" | "COMPLETED" | "INCOMPLETE";
	registrationSuccess: "UNKNOWN" | "PASSED" | "FAILED";
	score: { scaled: number } | null;
	totalSecondsTracked: number;
	firstAccessDate: string;
	lastAccessDate: string;
	runtime?: {
		suspendData: string;
		location: string;
		scoreRaw: string;
		scoreMin: string;
		scoreMax: string;
		runtimeInteractions: RuntimeInteraction[];
	};
}

export interface RuntimeInteraction {
	id: string;
	type: string;
	learnerResponse: string;
	result: string;
	correctResponses: string[];
}

export class ScormCloudError extends Error {
	constructor(
		public readonly status: number,
		public readonly endpoint: string,
		message: string,
	) {
		super(`SCORM Cloud API ${status} ${endpoint}: ${message}`);
		this.name = "ScormCloudError";
	}
}

export class ScormCloudClient {
	private readonly authHeader: string;

	constructor(appId: string, secretKey: string) {
		this.authHeader = `Basic ${Buffer.from(`${appId}:${secretKey}`).toString("base64")}`;
	}

	private async request<T>(
		method: string,
		path: string,
		opts?: { body?: unknown; query?: Record<string, string>; expectEmpty?: boolean },
	): Promise<T> {
		const url = new URL(`${BASE_URL}${path}`);
		if (opts?.query) {
			for (const [key, value] of Object.entries(opts.query)) {
				url.searchParams.set(key, value);
			}
		}

		const headers: Record<string, string> = {
			Authorization: this.authHeader,
		};
		let body: string | undefined;
		if (opts?.body) {
			headers["Content-Type"] = "application/json";
			body = JSON.stringify(opts.body);
		}

		let response: Response | undefined;
		let lastError: Error | undefined;
		const maxRetries = 3;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				response = await fetch(url.toString(), { method, headers, body });
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < maxRetries) {
					await this.sleep(1000 * 2 ** attempt);
					continue;
				}
				throw lastError;
			}

			if (response.status === 429 && attempt < maxRetries) {
				await this.sleep(1000 * 2 ** attempt);
				continue;
			}
			break;
		}

		if (!response) throw lastError ?? new Error("No response received");

		if (opts?.expectEmpty && (response.status === 204 || response.status === 200)) {
			return undefined as T;
		}

		if (response.status === 404 && method === "DELETE") {
			return undefined as T;
		}

		if (!response.ok) {
			const text = await response.text();
			let message: string;
			try {
				message = (JSON.parse(text) as { message?: string }).message ?? text;
			} catch {
				message = text;
			}
			throw new ScormCloudError(response.status, `${method} ${path}`, message);
		}

		return (await response.json()) as T;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async uploadCourse(courseId: string, zipBuffer: Buffer): Promise<string> {
		const url = new URL(`${BASE_URL}/courses/importJobs/upload`);
		url.searchParams.set("courseId", courseId);

		const formData = new FormData();
		formData.append(
			"file",
			new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }),
			"course.zip",
		);

		let response: Response | undefined;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= 3; attempt++) {
			try {
				response = await fetch(url.toString(), {
					method: "POST",
					headers: { Authorization: this.authHeader },
					body: formData,
				});
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < 3) {
					await this.sleep(1000 * 2 ** attempt);
					continue;
				}
				throw lastError;
			}
			if (response.status === 429 && attempt < 3) {
				await this.sleep(1000 * 2 ** attempt);
				continue;
			}
			break;
		}

		if (!response) throw lastError ?? new Error("No response received");

		if (!response.ok) {
			const text = await response.text();
			let message: string;
			try {
				message = (JSON.parse(text) as { message?: string }).message ?? text;
			} catch {
				message = text;
			}
			throw new ScormCloudError(response.status, "POST /courses/importJobs/upload", message);
		}

		const result = (await response.json()) as { result: string };
		return result.result;
	}

	async pollImportJob(jobId: string, opts?: PollOptions): Promise<ImportResult> {
		const maxAttempts = opts?.maxAttempts ?? 30;
		const intervalMs = opts?.intervalMs ?? 2000;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const raw = await this.request<{
				jobId: string;
				status: ImportStatus;
				message?: string;
				importResult?: {
					parserWarnings?: string[];
					course?: { id: string };
					webPathToCourse?: string;
				};
			}>("GET", `/courses/importJobs/${jobId}`);

			if (raw.status === "COMPLETE" || raw.status === "ERROR") {
				return {
					jobId: raw.jobId,
					status: raw.status,
					message: raw.message ?? "",
					parserWarnings: raw.importResult?.parserWarnings ?? [],
					courseId: raw.importResult?.course?.id ?? "",
					webPathToCourse: raw.importResult?.webPathToCourse ?? "",
				};
			}

			await this.sleep(intervalMs);
		}

		throw new Error(`Import job ${jobId} did not complete after ${maxAttempts} attempts`);
	}

	async getCourse(courseId: string): Promise<CourseInfo> {
		const raw = await this.request<{
			id: string;
			title: string;
			courseLearningStandard: string;
			registrationCount?: number;
			version?: number;
		}>("GET", `/courses/${courseId}`);
		return {
			id: raw.id,
			title: raw.title,
			courseLearningStandard: raw.courseLearningStandard,
			registrationCount: raw.registrationCount ?? 0,
			version: raw.version ?? 1,
		};
	}

	async listCourses(): Promise<CourseInfo[]> {
		const courses: CourseInfo[] = [];
		let more: string | undefined;

		do {
			const query: Record<string, string> = {};
			if (more) query.more = more;

			const raw = await this.request<{
				courses: Array<{
					id: string;
					title: string;
					courseLearningStandard: string;
					registrationCount?: number;
					version?: number;
				}>;
				more?: string;
			}>("GET", "/courses", { query });

			for (const c of raw.courses) {
				courses.push({
					id: c.id,
					title: c.title,
					courseLearningStandard: c.courseLearningStandard,
					registrationCount: c.registrationCount ?? 0,
					version: c.version ?? 1,
				});
			}
			more = raw.more;
		} while (more);

		return courses;
	}

	async setCourseConfiguration(
		courseId: string,
		settings: Array<{ settingId: string; value: string }>,
	): Promise<void> {
		await this.request<void>("POST", `/courses/${courseId}/configuration`, {
			body: { settings },
			expectEmpty: true,
		});
	}

	async deleteCourse(courseId: string): Promise<void> {
		await this.request<void>("DELETE", `/courses/${courseId}`, { expectEmpty: true });
	}

	async createRegistration(regId: string, courseId: string, learnerId: string): Promise<void> {
		await this.request<void>("POST", "/registrations", {
			body: {
				courseId,
				registrationId: regId,
				learner: { id: learnerId },
			},
			expectEmpty: true,
		});
	}

	async deleteRegistration(regId: string): Promise<void> {
		await this.request<void>("DELETE", `/registrations/${regId}`, { expectEmpty: true });
	}

	async getLaunchLink(regId: string, opts: LaunchOptions): Promise<string> {
		const body: Record<string, unknown> = {
			redirectOnExitUrl: opts.redirectOnExitUrl,
			expiry: opts.expiry ?? 300,
		};

		if (opts.additionalValues) {
			body.additionalvalues = opts.additionalValues.map((av) => ({
				item: av.item,
				value: av.value,
			}));
		}

		const raw = await this.request<{ launchLink: string }>(
			"POST",
			`/registrations/${regId}/launchLink`,
			{ body },
		);
		return raw.launchLink;
	}

	async getProgress(regId: string, opts?: ProgressOptions): Promise<RegistrationProgress> {
		const query: Record<string, string> = {};
		if (opts?.includeRuntime || opts?.includeInteractionsAndObjectives) {
			query.includeChildResults = "true";
		}
		if (opts?.includeRuntime) query.includeRuntime = "true";
		if (opts?.includeInteractionsAndObjectives) query.includeInteractionsAndObjectives = "true";

		const raw = await this.request<{
			registrationCompletion: string;
			registrationSuccess: string;
			score: { scaled: number };
			totalSecondsTracked: number;
			firstAccessDate: string;
			lastAccessDate: string;
			activityDetails?: {
				runtime?: {
					suspendData?: string;
					location?: string;
					scoreRaw?: string;
					scoreMin?: string;
					scoreMax?: string;
					runtimeInteractions?: Array<{
						id: string;
						type: string;
						learnerResponse: string;
						result: string;
						correctResponses: string[];
					}>;
				};
			};
		}>("GET", `/registrations/${regId}`, { query });

		const result: RegistrationProgress = {
			registrationCompletion:
				raw.registrationCompletion as RegistrationProgress["registrationCompletion"],
			registrationSuccess: raw.registrationSuccess as RegistrationProgress["registrationSuccess"],
			score: raw.score,
			totalSecondsTracked: raw.totalSecondsTracked,
			firstAccessDate: raw.firstAccessDate,
			lastAccessDate: raw.lastAccessDate,
		};

		// SCORM Cloud nests runtime data at different paths depending on configuration:
		// - Single SCO: activityDetails.runtime
		// - Multi SCO: activityDetails.children[0].runtime
		// biome-ignore lint/suspicious/noExplicitAny: external API response shape
		const actDetails = raw.activityDetails as any;
		const runtimeSource = actDetails?.runtime ?? actDetails?.children?.[0]?.runtime;
		if (opts?.includeRuntime && runtimeSource) {
			const rt = runtimeSource;
			result.runtime = {
				suspendData: rt.suspendData ?? "",
				location: rt.location ?? "",
				scoreRaw: rt.scoreRaw ?? "",
				scoreMin: rt.scoreMin ?? "",
				scoreMax: rt.scoreMax ?? "",
				runtimeInteractions: (rt.runtimeInteractions ?? []).map((i: Record<string, unknown>) => ({
					id: i.id,
					type: i.type,
					learnerResponse: i.learnerResponse,
					result: i.result,
					correctResponses: i.correctResponses ?? [],
				})),
			};
		}

		return result;
	}
}
