import {
	decodeEscapes,
	type FillBlankResponse,
	parseFillBlankContent,
	splitUnescaped,
} from "@praxity/content-model";
import type { BlockSchema, ValidationError } from "../validation-types.ts";

interface AssessmentOption {
	text?: unknown;
	label?: unknown;
	correct?: unknown;
	isCorrect?: unknown;
}

function getOptionText(option: AssessmentOption): string {
	if (typeof option.text === "string") return option.text;
	if (typeof option.label === "string") return option.label;
	return "";
}

function isOptionCorrect(option: AssessmentOption): boolean {
	if (typeof option.correct === "boolean") return option.correct;
	if (typeof option.isCorrect === "boolean") return option.isCorrect;
	return false;
}

function validateChoiceAssessment(
	assessmentType: "single" | "multi",
	options: AssessmentOption[],
	blockId: string,
	blockType: string,
	feedback: unknown,
): ValidationError[] {
	const errors: ValidationError[] = [];

	if (options.length < 2) {
		errors.push({
			id: "assessment-too-few-options",
			level: "error",
			message: "Assessment requires at least 2 options.",
			blockId,
			blockType,
			category: "content",
		});
	}

	const isScored = feedback !== "deferred";
	const hasCorrect = options.some((option) => isOptionCorrect(option));
	if (isScored && !hasCorrect) {
		errors.push({
			id: "assessment-no-correct-answer",
			level: "error",
			message: "Scored assessment has no correct answer marked.",
			blockId,
			blockType,
			category: "content",
		});
	}

	for (let index = 0; index < options.length; index++) {
		const text = getOptionText(options[index]);
		if (text.trim().length > 0) continue;
		errors.push({
			id: "assessment-empty-option",
			level: "warning",
			message: `Option ${index + 1} has empty text.`,
			blockId,
			blockType,
			category: "content",
		});
	}

	if (assessmentType === "multi" && options.length > 2) {
		const correctCount = options.filter((option) => isOptionCorrect(option)).length;
		if (correctCount === 1) {
			errors.push({
				id: "choose-many-single-correct",
				level: "info",
				message: "Only one correct answer is marked in a choose-many assessment.",
				blockId,
				blockType,
				category: "content",
			});
		}
	}

	return errors;
}

type ValidateArgs = Parameters<NonNullable<BlockSchema["validate"]>>;

export const assessmentSchema: BlockSchema = {
	keyword: "assessment",
	blockType: "assessment",
	attributes: {
		deckGate: { type: "enum", required: false, matches: ["attempt", "pass"] },
		question: {
			type: "string",
			read: (block) =>
				Array.isArray(block.data?.stem)
					? block.data.stem
							.map((child: { data?: { content?: unknown } }) =>
								typeof child?.data?.content === "string"
									? child.data.content.replace(/<[^>]*>/g, "")
									: "",
							)
							.join(" ")
							.trim()
					: block.data?.question,
			required: true,
			errorLevel: "error",
		},
		description: { type: "string", required: false },
		display: {
			type: "enum",
			required: false,
			matches: ["standard", "scenario"],
		},
		buttonLabel: { type: "string", required: false },
		feedbackMode: {
			type: "enum",
			required: false,
			matches: ["retry", "reveal", "unified", "perOption"],
		},
		private: { type: "boolean", required: false },
		downloadAs: {
			type: "enum",
			required: false,
			matches: ["txt", "docx", "both"],
		},
		scored: { type: "boolean", required: false },
		shuffle: { type: "boolean", required: false },
		required: { type: "boolean", required: false },
		points: { type: "number", required: false, min: 0 },
		attempts: { type: "number", required: false, min: 0 },
		// `pass` is gone, not deprecated. It duplicated `passingScore` and was the
		// half nothing read, so a pass threshold is a group-level concept: use
		// `assessment-group` with `passingScore`. Unknown parameters are ignored
		// rather than flagged (validate.ts iterates the schema, not the document),
		// so existing files carrying `pass:` keep parsing exactly as before — the
		// value was never applied either way.
		timed: { type: "number", required: false, min: 1 },
		feedback: {
			type: "enum",
			required: false,
			matches: ["immediate", "after-submit", "after-all", "never", "deferred"],
		},
		competency: { type: "string", required: false },
		confidence: { type: "boolean", required: false },
		retrieval: { type: "boolean", required: false },
	},
	validate(block, config) {
		return [...hotspotRegionWarnings(block, config), ...validateAssessment(block, config)];
	},
};

function hotspotRegionWarnings(...[block, config]: ValidateArgs): ValidationError[] {
	const data = block.data as Record<string, unknown>;
	if (data.assessmentType !== "hotspot") return [];
	return (Array.isArray(data.spots) ? data.spots : []).flatMap((value, index) => {
		if (!value || typeof value !== "object") return [];
		const spot = value as Record<string, unknown>;
		const coords = spot.region;
		if (!Array.isArray(coords) || !coords.every((n) => typeof n === "number" && Number.isFinite(n)))
			return [];
		let smaller = 100;
		if (spot.shape === "rect") smaller = Math.min(coords[2], coords[3]);
		if (spot.shape === "ellipse") smaller = 2 * Math.min(coords[2], coords[3]);
		if (spot.shape === "polygon") {
			const xs = coords.filter((_, i) => i % 2 === 0);
			const ys = coords.filter((_, i) => i % 2 === 1);
			smaller = Math.min(
				xs.reduce((max, x) => Math.max(max, x), 0) - xs.reduce((min, x) => Math.min(min, x), 100),
				ys.reduce((max, y) => Math.max(max, y), 0) - ys.reduce((min, y) => Math.min(min, y), 100),
			);
		}
		return smaller < 8
			? [
					{
						id: "hotspot-region-small",
						level: "warning" as const,
						message: config.frontmatter.lang?.startsWith("fr")
							? `La zone ${index + 1} a une dimension inférieure à 8 % de l'image. Agrandissez-la pour faciliter la sélection.`
							: `Spot ${index + 1} has a region with a dimension under 8% of the image. Enlarge it for easier selection.`,
						blockId: block.id,
						blockType: block.type,
						category: "accessibility" as const,
					},
				]
			: [];
	});
}

function validateAssessment(...[block, config]: ValidateArgs): ValidationError[] {
	const data = block.data as Record<string, unknown>;
	const assessmentType = data.assessmentType;
	if (
		data.feedbackMode === "reveal" &&
		!["single", "multi", "choice", "matching", "sequence", "fillBlank", "categorize"].includes(
			String(assessmentType),
		)
	) {
		return [
			{
				id: "assessment-reveal-unsupported",
				level: "error",
				message:
					"feedbackMode: reveal requires a choice, match, order, fill-blank, or categorize assessment.",
				blockId: block.id,
				blockType: block.type,
				category: "content",
			},
		];
	}
	const optionsRaw = data.options;
	const response =
		data.response && typeof data.response === "object"
			? (data.response as Record<string, unknown>)
			: data;
	if (response.type === "choice") {
		return validateChoiceAssessment(
			response.selectionMode === "multiple" ? "multi" : "single",
			Array.isArray(response.options) ? response.options : [],
			block.id,
			block.type,
			data.gradingMode === "none" || data.scored === false ? "deferred" : "immediate",
		);
	}
	if (
		assessmentType === "fillBlank" &&
		(response.style === "dropdown" || response.style === "word-bank")
	) {
		const blanks = Array.isArray(response.blanks)
			? (response.blanks as FillBlankResponse["blanks"])
			: parseFillBlankContent(typeof data.content === "string" ? data.content : "", response.style);
		const bank = Array.isArray(response.wordBank)
			? response.wordBank
			: typeof data.bank === "string"
				? splitUnescaped(data.bank, "|").map((word) => decodeEscapes(word.trim()))
				: [];
		const counts = new Map<string, number>();
		const invalid =
			blanks.length === 0 ||
			blanks.some((blank) => {
				if (!blank || typeof blank.answer !== "string" || !blank.answer.trim()) return true;
				const answers = [
					blank.answer,
					...(Array.isArray(blank.alternatives) ? blank.alternatives : []),
				];
				if (answers.some((answer) => typeof answer !== "string" || !answer.trim())) return true;
				if (response.style === "dropdown") {
					const choices = blank.choices;
					return (
						!Array.isArray(choices) ||
						choices.length < 2 ||
						choices.some((choice) => typeof choice !== "string" || !choice.trim()) ||
						new Set(choices).size !== choices.length ||
						answers.some((answer) => !choices.includes(answer))
					);
				}
				counts.set(blank.answer, (counts.get(blank.answer) ?? 0) + 1);
				return (
					bank.length === 0 ||
					bank.some((word) => typeof word !== "string" || !word.trim()) ||
					answers.some((answer) => !bank.includes(answer)) ||
					(counts.get(blank.answer) ?? 0) > bank.filter((word) => word === blank.answer).length
				);
			});
		if (invalid)
			return [
				{
					id: "fill-blank-invalid-choices",
					level: "error",
					message:
						response.style === "dropdown"
							? "Dropdown blanks require at least two distinct choices and a *-marked correct answer in every blank."
							: "Word-bank blanks require answers present in the bank, with enough entries for repeated answers.",
					blockId: block.id,
					blockType: block.type,
					category: "content",
				},
			];
	}
	if (assessmentType === "fillBlank" && data.feedbackMode === "reveal") {
		const blanks = Array.isArray(response.blanks)
			? (response.blanks as Array<Record<string, unknown>>)
			: undefined;
		const content = typeof data.content === "string" ? data.content : "";
		const hasAnswers = blanks
			? blanks.length > 0 &&
				blanks.every((blank) => typeof blank?.answer === "string" && blank.answer.trim())
			: parseFillBlankContent(content).length > 0 &&
				parseFillBlankContent(content).every((blank) => Boolean(blank.answer));
		if (!hasAnswers)
			return [
				{
					id: "fill-blank-missing-answer",
					level: "error",
					message: "feedbackMode: reveal requires a configured answer for every blank.",
					blockId: block.id,
					blockType: block.type,
					category: "content",
				},
			];
	}
	const options = Array.isArray(optionsRaw) ? (optionsRaw as AssessmentOption[]) : [];

	if (assessmentType === "single" || assessmentType === "multi") {
		return validateChoiceAssessment(
			assessmentType,
			options,
			block.id,
			block.type,
			data.feedbackMode === "reveal" ? "immediate" : data.feedback,
		);
	}

	return [];
}
