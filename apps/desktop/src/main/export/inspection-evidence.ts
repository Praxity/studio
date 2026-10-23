import { createHash } from "node:crypto";
import path from "node:path";
import type { ReadLessonResult } from "@praxity/grammar";
import { assessmentShuffle } from "@praxity/shared-blocks/assessment-choice";
import { createProjectAssetAdmission } from "../project-assets";

/** Both inspect schemas must refuse descriptions their projection cannot preserve. */
export function refuseUnsupportedDescriptions(read: ReadLessonResult, file: string): void {
	const error = read.errors.find(
		(error) =>
			error.level === "error" &&
			error.messageRef.key === "grammar.v4.disallowed-child" &&
			error.messageRef.args.type === "free-response",
	);
	if (error)
		throw Object.assign(
			new Error(`${file}:${error.line}:${error.column}: ${error.messageRef.key}`),
			{ code: "EASSESSMENTDESCRIPTION" },
		);
}

export function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
export const records = (value: unknown) => (Array.isArray(value) ? value.filter(record) : []);
export const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export interface InspectionAsset {
	uri: string;
	availability: "present" | "missing" | "remote" | "blocked";
	sha256: string | null;
}

/** Only explicitly referenced project files are read. External URLs are never fetched. */
export function assetInspector(projectDir: string) {
	const admission = createProjectAssetAdmission(projectDir);
	const assets = new Map<string, InspectionAsset>();
	const pending = new Map<string, Promise<InspectionAsset | null>>();
	const inspect = async (value: unknown): Promise<InspectionAsset | null> => {
		if (typeof value !== "string" || !value.trim()) return null;
		const uri = value.trim();
		const cached = assets.get(uri);
		if (cached) return cached;
		const result: InspectionAsset = { uri, availability: "missing", sha256: null };
		if (/^(?:https?:)?\/\//i.test(uri)) result.availability = "remote";
		else if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.includes("\\") || uri.includes("\0"))
			result.availability = "blocked";
		else {
			try {
				// Leading slash is Studio's project-root asset syntax, not a host absolute path.
				const relative = decodeURIComponent(uri.replace(/^\/+/, "").split(/[?#]/, 1)[0]);
				const target = path.resolve(projectDir, relative);
				if (
					relative.includes("\\") ||
					relative.includes("\0") ||
					path.relative(projectDir, target).split(path.sep).includes("..")
				)
					result.availability = "blocked";
				else {
					const file = await admission.open(target);
					try {
						const hash = createHash("sha256");
						for await (const chunk of file.createReadStream({ autoClose: false }))
							hash.update(chunk);
						result.sha256 = hash.digest("hex");
					} finally {
						await file.close();
					}
					result.availability = "present";
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.availability = "blocked";
			}
		}
		assets.set(uri, result);
		return result;
	};
	return {
		assets,
		async finish() {
			await Promise.all(pending.values());
			await admission.finish();
		},
		read(value: unknown) {
			if (typeof value !== "string") return Promise.resolve(null);
			const uri = value.trim();
			const existing = pending.get(uri);
			if (existing) return existing;
			const result = inspect(uri);
			pending.set(uri, result);
			return result;
		},
	};
}

export interface AssessmentEvidence {
	responseType: string;
	correctness: "keyed" | "open" | "unavailable";
	selectionMode: string | null;
	inputMethod: string | null;
	scoring: {
		gradingMode: string;
		scored: boolean;
		points: number | null;
		required: boolean;
		attempts: number;
		feedbackMode: string | null;
	};
	options?: Array<{ ref: string; label: string; correct: boolean }>;
	shuffle?: boolean;
	pairs?: Array<{ ref: string; prompt: string; correctMatch: string }>;
	items?: Array<{ ref: string; label: string; correctPosition: number | null }>;
	categories?: Array<{ ref: string; label: string; items: string[] }>;
	blanks?: Array<{
		ref: string;
		answers: string[];
		choices: string[];
		answerRules: Array<{ value: string; match: "literal" | "wildcard"; pattern: string | null }>;
	}>;
	blankStyle?: string;
	wordBank?: string[];
	hotspots?: Array<{
		ref: string;
		label: string;
		shape: string;
		coordinates: number[];
		correct: boolean;
	}>;
	statements?: Array<{ ref: string; text: string; correctValues: number[] }>;
	scalePoints?: Array<{ value: number | null; label: string }>;
}

export function assessmentEvidence(data: Record<string, unknown>, ref: string): AssessmentEvidence {
	const response = record(data.response) ? data.response : {};
	const type = text(response.type) || text(data.assessmentType);
	const gradingMode = text(data.gradingMode) || (data.graded === true ? "exact" : "none");
	const result: AssessmentEvidence = {
		responseType: type,
		correctness: "unavailable",
		selectionMode: typeof response.selectionMode === "string" ? response.selectionMode : null,
		inputMethod: typeof response.inputMethod === "string" ? response.inputMethod : null,
		scoring: {
			gradingMode,
			scored: false,
			points: number(data.points),
			required: false,
			attempts: 1,
			feedbackMode: typeof data.feedbackMode === "string" ? data.feedbackMode : null,
		},
	};
	const itemRef = (family: string, index: number) => `${ref}/response/${family}/${index}`;
	switch (type) {
		case "choice":
			result.shuffle = assessmentShuffle(data);
			result.options = records(response.options).map((v, i) => ({
				ref: itemRef("options", i),
				label: text(v.label),
				correct: v.isCorrect === true,
			}));
			result.correctness = result.options.some((v) => v.correct) ? "keyed" : "open";
			break;
		case "matching":
			result.pairs = records(response.pairs).map((v, i) => ({
				ref: itemRef("pairs", i),
				prompt: text(v.prompt),
				correctMatch: text(v.correctMatch),
			}));
			result.correctness = result.pairs.length ? "keyed" : "open";
			break;
		case "sequence":
			result.items = records(response.items).map((v, i) => ({
				ref: itemRef("items", i),
				label: text(v.label),
				correctPosition: number(v.correctPosition),
			}));
			result.correctness = result.items.length ? "keyed" : "open";
			break;
		case "categorize":
			result.categories = records(response.categories).map((v, i) => ({
				ref: itemRef("categories", i),
				label: text(v.name),
				items: strings(v.items),
			}));
			result.correctness = result.categories.some((v) => v.items.length) ? "keyed" : "open";
			break;
		case "fillBlank":
			result.blankStyle = text(response.style) || "inline-inputs";
			result.blanks = records(response.blanks).map((v, i) => {
				const answers = [text(v.answer), ...strings(v.alternatives)];
				const sources = Array.isArray(v.answerSources) ? strings(v.answerSources) : answers;
				const selectable = response.style === "dropdown" || response.style === "word-bank";
				return {
					ref: itemRef("blanks", i),
					answers: answers.filter((value) => value.trim()),
					choices: strings(v.choices),
					answerRules: answers.flatMap((value, index) => {
						if (!value.trim()) return [];
						const source = sources[index] ?? value;
						const wildcard = !selectable && source.trim().startsWith("~");
						return [
							{
								value,
								match: wildcard ? ("wildcard" as const) : ("literal" as const),
								pattern: wildcard ? source.trim().slice(1) : null,
							},
						];
					}),
				};
			});
			result.wordBank = strings(response.wordBank);
			result.correctness = result.blanks.some((v) => v.answers.length) ? "keyed" : "open";
			break;
		case "hotspot":
			result.hotspots = records(response.hotspots).map((v, i) => ({
				ref: itemRef("hotspots", i),
				label: text(v.label),
				shape: text(v.shape),
				coordinates: Array.isArray(v.coords)
					? v.coords.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
					: [],
				correct: v.isCorrect === true,
			}));
			result.correctness = result.hotspots.some((v) => v.correct) ? "keyed" : "open";
			break;
		case "matrix":
			result.statements = records(response.statements).map((v, i) => ({
				ref: itemRef("statements", i),
				text: text(v.text),
				correctValues: Array.isArray(v.correctValues)
					? v.correctValues.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
					: [],
			}));
			result.scalePoints = records(response.scalePoints).map((v) => ({
				value: number(v.value),
				label: text(v.label),
			}));
			// The supported matrix is a survey, without runtime answer checking.
			result.correctness = "open";
			break;
		case "textResponse":
		case "fileUpload":
		case "audioRecording":
		case "videoRecording":
		case "speech":
		case "dictation":
			result.correctness = "open";
	}
	const canAutoScore =
		result.correctness === "keyed" ||
		["hotspot", "matching", "sequence", "categorize"].includes(type);
	const isGraded =
		gradingMode !== "none" && (type !== "fillBlank" || result.correctness === "keyed");
	result.scoring.scored = isGraded && canAutoScore;
	result.scoring.required = typeof data.required === "boolean" ? data.required : isGraded;
	result.scoring.attempts =
		data.feedbackMode === "reveal" && canAutoScore && type !== "hotspot"
			? 1
			: (number(data.attempts) ?? (!isGraded && canAutoScore ? 0 : 1));
	return result;
}
