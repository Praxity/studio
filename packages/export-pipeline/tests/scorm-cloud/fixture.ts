import { isIdentityNodeId, type PraxityPage } from "@praxity/shared-blocks/types";
import { buildScormPackage, type CourseExportInput } from "../../src/build";
import { loadGrammarFixture } from "../fixtures/load-grammar-fixture";

export interface ScormCloudFixtures {
	scorm12Zip: Buffer;
	scorm2004Zip: Buffer;
	pageCount: number;
	scoredQuestionCount: number;
	/** The completion method used to build this fixture. */
	completionMethod?: "allPages" | "percentage" | "quiz";
}

function createMinimalCourse(): { pages: PraxityPage[]; scoredQuestionCount: number } {
	const pages: PraxityPage[] = [
		{
			id: "page-welcome",
			title: "Welcome",
			blocks: [
				{
					id: "b-welcome-text",
					type: "text",
					data: {
						content: "<h2>Welcome</h2><p>This is the SCORM Cloud integration test course.</p>",
					},
				},
			],
		},
		{
			id: "page-learning",
			title: "Learning Material",
			blocks: [
				{
					id: "b-learning-text",
					type: "text",
					data: { content: "<p>Some important content to review.</p>" },
				},
				{
					id: "b-learning-accordion",
					type: "accordion",
					data: {
						items: [
							{
								id: "section-a",
								label: "Section A",
								children: [
									{
										id: "section-a-text",
										type: "text",
										data: { content: "<p>Details about section A.</p>" },
									},
								],
							},
							{
								id: "section-b",
								label: "Section B",
								children: [
									{
										id: "section-b-text",
										type: "text",
										data: { content: "<p>Details about section B.</p>" },
									},
								],
							},
						],
					},
				},
			],
		},
		{
			id: "page-quiz",
			title: "Quiz",
			blocks: [
				{
					id: "b-quiz-choice-1",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-q1-stem",
								type: "text",
								data: { content: "<p>What color is the sky on a clear day?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "q1-a", label: "Red", isCorrect: false },
								{ id: "q1-b", label: "Blue", isCorrect: true },
								{ id: "q1-c", label: "Green", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
				{
					id: "b-quiz-choice-2",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-q2-stem",
								type: "text",
								data: { content: "<p>What is 2 + 2?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "q2-a", label: "3", isCorrect: false },
								{ id: "q2-b", label: "4", isCorrect: true },
								{ id: "q2-c", label: "5", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
				{
					id: "b-quiz-match",
					type: "assessment",
					data: {
						assessmentType: "matching",
						stem: [
							{
								id: "b-q3-stem",
								type: "text",
								data: { content: "<p>Match each country to its capital.</p>" },
							},
						],
						response: {
							type: "matching",
							inputMethod: "dropdown",
							pairs: [
								{ id: "m1", matchId: "match-paris", prompt: "France", correctMatch: "Paris" },
								{ id: "m2", matchId: "match-tokyo", prompt: "Japan", correctMatch: "Tokyo" },
							],
							distractors: ["London"],
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
			],
		},
		{
			id: "page-summary",
			title: "Summary",
			blocks: [
				{
					id: "b-summary-text",
					type: "text",
					data: { content: "<p>You have completed the course.</p>" },
				},
			],
		},
	];

	return { pages, scoredQuestionCount: 3 };
}

function createRequiredBlocksCourse(): { pages: PraxityPage[]; scoredQuestionCount: number } {
	const assessmentId = "b-required-choice";
	const pages: PraxityPage[] = [
		{
			id: "page-welcome",
			title: "Welcome",
			blocks: [
				{
					id: "b-welcome-text",
					type: "text",
					data: {
						content: "<h2>Welcome</h2><p>Complete the quiz on the next page to continue.</p>",
					},
				},
			],
		},
		{
			id: "page-quiz",
			title: "Quiz",
			blocks: [
				{
					// Logic block: unconditionally require the assessment below.
					// Conditions array is empty so the rule always fires on page load.
					id: "logic-require-assessment",
					type: "logic",
					data: {
						conditions: { operator: "and", rules: [] },
						actions: [{ type: "require", targets: [assessmentId] }],
					},
				},
				{
					id: assessmentId,
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-req-stem",
								type: "text",
								data: { content: "<p>Which planet is closest to the Sun?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "req-a", label: "Venus", isCorrect: false },
								{ id: "req-b", label: "Mercury", isCorrect: true },
								{ id: "req-c", label: "Mars", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
			],
		},
		{
			id: "page-summary",
			title: "Summary",
			blocks: [
				{
					id: "b-summary-text",
					type: "text",
					data: { content: "<p>You have completed the required quiz.</p>" },
				},
			],
		},
	];

	return { pages, scoredQuestionCount: 1 };
}

function createQuizCompletionCourse(): { pages: PraxityPage[]; scoredQuestionCount: number } {
	const pages: PraxityPage[] = [
		{
			id: "page-welcome",
			title: "Welcome",
			blocks: [
				{
					id: "b-welcome-text",
					type: "text",
					data: {
						content: "<h2>Welcome</h2><p>Score 80% or higher to pass this course.</p>",
					},
				},
			],
		},
		{
			id: "page-quiz",
			title: "Quiz",
			blocks: [
				{
					id: "b-quiz-q1",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-q1-stem",
								type: "text",
								data: { content: "<p>What is the capital of France?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "q1-a", label: "Berlin", isCorrect: false },
								{ id: "q1-b", label: "Paris", isCorrect: true },
								{ id: "q1-c", label: "Madrid", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
				{
					id: "b-quiz-q2",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-q2-stem",
								type: "text",
								data: { content: "<p>What is 5 × 5?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "q2-a", label: "20", isCorrect: false },
								{ id: "q2-b", label: "25", isCorrect: true },
								{ id: "q2-c", label: "30", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
			],
		},
		{
			id: "page-summary",
			title: "Summary",
			blocks: [
				{
					id: "b-summary-text",
					type: "text",
					data: { content: "<p>You have completed the quiz. Check your score above.</p>" },
				},
			],
		},
	];

	return { pages, scoredQuestionCount: 2 };
}

function createLogicRulesCourse(): { pages: PraxityPage[]; scoredQuestionCount: number } {
	const assessmentId = "b-logic-quiz-choice";
	const pages: PraxityPage[] = [
		{
			id: "page-welcome",
			title: "Welcome",
			blocks: [
				{
					id: "b-welcome-text",
					type: "text",
					data: {
						content:
							"<h2>Welcome</h2><p>Answer the quiz to continue. Correct answers jump straight to the summary.</p>",
					},
				},
			],
		},
		{
			id: "page-quiz",
			title: "Quiz",
			blocks: [
				{
					// Logic block: if the assessment is passed, jump to the summary page.
					// If the condition is not met (incorrect answer), linear navigation
					// proceeds to the remediation page instead.
					id: "logic-jump-on-correct",
					type: "logic",
					data: {
						conditions: {
							operator: "and",
							rules: [
								{
									source: `block:${assessmentId}`,
									field: "passed",
									comparison: "is",
									value: true,
								},
							],
						},
						actions: [{ type: "jumpToPage", target: "page-summary" }],
					},
				},
				{
					id: assessmentId,
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-logic-stem",
								type: "text",
								data: { content: "<p>Which gas makes up most of Earth's atmosphere?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "logic-a", label: "Oxygen", isCorrect: false },
								{ id: "logic-b", label: "Nitrogen", isCorrect: true },
								{ id: "logic-c", label: "Carbon dioxide", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
				{
					// Exercise logic, assessment, and rating islands on one page.
					id: "b-logic-confidence-rating",
					type: "rating",
					data: {
						label: "How confident are you in your answer?",
						style: "stars",
						maxValue: 5,
					},
				},
			],
		},
		{
			id: "page-remediation",
			title: "Remediation",
			blocks: [
				{
					id: "b-remediation-text",
					type: "text",
					data: { content: "<p>Review the material and try again.</p>" },
				},
			],
		},
		{
			id: "page-summary",
			title: "Summary",
			blocks: [
				{
					id: "b-summary-text",
					type: "text",
					data: { content: "<p>You have completed the course. Well done!</p>" },
				},
			],
		},
	];

	return { pages, scoredQuestionCount: 1 };
}

function createLogicPersistenceCourse(): { pages: PraxityPage[]; scoredQuestionCount: number } {
	const variableName = "quiz_outcome";
	const assessmentId = "b-logic-persist-quiz";
	const pages: PraxityPage[] = [
		{
			id: "page-logic-persist-quiz",
			title: "Knowledge Check",
			blocks: [
				{
					id: "var-logic-persist-page1",
					type: "variable",
					data: {
						variableName,
						dataType: "text",
						source: "manual",
						defaultValue: "unset",
					},
				},
				{
					id: "logic-set-variable-on-pass",
					type: "logic",
					data: {
						conditions: {
							operator: "and",
							rules: [
								{
									source: `block:${assessmentId}`,
									field: "passed",
									comparison: "is",
									value: true,
								},
							],
						},
						actions: [
							{
								type: "setVariable",
								targets: [variableName],
								value: "passed",
							},
						],
					},
				},
				{
					id: assessmentId,
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "b-logic-persist-stem",
								type: "text",
								data: { content: "<p>What is the largest planet in our solar system?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [
								{ id: "persist-a", label: "Mars", isCorrect: false },
								{ id: "persist-b", label: "Jupiter", isCorrect: true },
								{ id: "persist-c", label: "Venus", isCorrect: false },
							],
							display: "list",
							shuffle: false,
						},
						feedback: {},
						gradingMode: "exact",
						points: 1,
					},
				},
			],
		},
		{
			id: "page-logic-persist-summary",
			title: "Summary",
			blocks: [
				{
					id: "var-logic-persist-page2",
					type: "variable",
					data: {
						variableName,
						dataType: "text",
						source: "manual",
						defaultValue: "unset",
					},
				},
				{
					id: "b-logic-persist-summary-text",
					type: "text",
					data: {
						content:
							'<p id="logic-persist-outcome">Saved outcome: <span data-mention="variable:quiz_outcome"></span></p>',
					},
				},
			],
		},
	];

	return { pages, scoredQuestionCount: 1 };
}

export interface FixtureOptions {
	full?: boolean;
	navigationStyle?: NonNullable<CourseExportInput["navigationStyle"]>;
	navToggles?: CourseExportInput["navToggles"];
	/** Which course variant to build. Defaults to "minimal". */
	variant?: "minimal" | "required" | "quizCompletion" | "logic" | "logicPersistence";
}

export async function buildScormCloudFixtures(opts?: FixtureOptions): Promise<ScormCloudFixtures> {
	let pages: PraxityPage[];
	let fullFixture: Awaited<ReturnType<typeof loadGrammarFixture>> | undefined;
	let scoredQuestionCount: number;
	let completionMethod: "allPages" | "percentage" | "quiz" | undefined;
	let completionThreshold: number | undefined;

	const variant = opts?.variant ?? "minimal";

	// Legacy: opts.full loads the grammar fixture regardless of variant.
	if (opts?.full) {
		fullFixture = await loadGrammarFixture();
		// This runtime fixture originally fits SCORM 1.2's fixed state budget.
		// Give its public model deterministic test IDs; preserve every reference,
		// including option IDs and rendered data-node-id attributes. UUID capacity
		// remains covered by the storage-risk and overflow contracts.
		const identifiers = new Map<string, string>();
		const collect = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			const record = value as Record<string, unknown>;
			if (isIdentityNodeId(record.id) && !identifiers.has(record.id))
				identifiers.set(record.id, `g4-${identifiers.size.toString(36)}`);
			for (const child of Object.values(record)) collect(child);
		};
		collect(fullFixture.course.blocks);
		if (!identifiers.size) throw new Error("Missing grammar 4 fixture identities");
		const model = JSON.stringify({
			blocks: fullFixture.course.blocks,
			frontmatter: fullFixture.course.frontmatter,
		});
		const projected = JSON.parse(
			model.replace(
				new RegExp([...identifiers.keys()].join("|"), "g"),
				(id) => identifiers.get(id) ?? id,
			),
		) as Pick<typeof fullFixture.course, "blocks" | "frontmatter">;
		fullFixture = { ...fullFixture, course: { ...fullFixture.course, ...projected } };
		pages = fullFixture.pages;
		scoredQuestionCount = pages.reduce((count, page) => {
			return (
				count +
				page.blocks.filter((b) => {
					if (b.type !== "assessment" || typeof b.data !== "object" || b.data === null) {
						return false;
					}
					if (!("points" in b.data)) {
						return false;
					}
					const points = (b.data as { points?: number }).points;
					return points != null && points > 0;
				}).length
			);
		}, 0);
	} else if (variant === "required") {
		const fixture = createRequiredBlocksCourse();
		pages = fixture.pages;
		scoredQuestionCount = fixture.scoredQuestionCount;
	} else if (variant === "quizCompletion") {
		const fixture = createQuizCompletionCourse();
		pages = fixture.pages;
		scoredQuestionCount = fixture.scoredQuestionCount;
		completionMethod = "quiz";
	} else if (variant === "logic") {
		const fixture = createLogicRulesCourse();
		pages = fixture.pages;
		scoredQuestionCount = fixture.scoredQuestionCount;
		completionMethod = "percentage";
		completionThreshold = 75;
	} else if (variant === "logicPersistence") {
		const fixture = createLogicPersistenceCourse();
		pages = fixture.pages;
		scoredQuestionCount = fixture.scoredQuestionCount;
	} else {
		const minimal = createMinimalCourse();
		pages = minimal.pages;
		scoredQuestionCount = minimal.scoredQuestionCount;
	}

	const courseInput = {
		id: "scorm-cloud-test",
		title: "SCORM Cloud Integration Test",
		sourceLocale: "en",
		content: pages,
		navigationStyle: opts?.navigationStyle,
		navToggles: opts?.navToggles,
		completionMethod,
		completionThreshold,
	};

	const [scorm12Result, scorm2004Result] = await Promise.all(
		fullFixture
			? [
					buildScormPackage(fullFixture.course, {
						...fullFixture.buildOptions,
						format: "scorm12",
					}),
					buildScormPackage(fullFixture.course, {
						...fullFixture.buildOptions,
						format: "scorm2004",
					}),
				]
			: [
					buildScormPackage(courseInput, { format: "scorm12" }),
					buildScormPackage(courseInput, { format: "scorm2004" }),
				],
	);

	return {
		scorm12Zip: scorm12Result.zip,
		scorm2004Zip: scorm2004Result.zip,
		pageCount: pages.length,
		scoredQuestionCount,
		completionMethod,
	};
}
