import type { CourseExportInput } from "@praxity/export-pipeline";
import type { PraxityPage } from "@praxity/shared-blocks";

const page1Content: PraxityPage = {
	id: "page-1-content",
	title: "Content Blocks",
	blocks: [
		{
			id: "b-text-1",
			type: "text",
			data: {
				content:
					"<p>This is a paragraph with <strong>bold</strong> and <em>italic</em> text for testing rich text rendering.</p>",
			},
		},
		{
			id: "b-heading-h2",
			type: "heading",
			data: { content: "Section Heading (H2)", level: 2 },
		},
		{
			id: "b-text-2",
			type: "text",
			data: {
				content: "<p>Text under the H2 heading to test document flow and reading order.</p>",
			},
		},
		{
			id: "b-heading-h3",
			type: "heading",
			data: { content: "Subsection Heading (H3)", level: 3 },
		},
		{
			id: "b-image-alt",
			type: "image",
			data: {
				src: "https://placehold.co/600x400/png",
				altText: "A placeholder image for accessibility testing",
				decorative: false,
				caption: "Figure 1: Test image with alt text",
			},
		},
		{
			id: "b-image-decorative",
			type: "image",
			data: {
				src: "https://placehold.co/600x200/png",
				altText: "",
				decorative: true,
			},
		},
		{
			id: "b-video",
			type: "video",
			data: {
				src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
				title: "Sample video for a11y testing",
				transcript: "This is a sample transcript for the video content.",
			},
		},
		{
			id: "b-audio",
			type: "audio",
			data: {
				src: "https://example.com/sample.mp3",
				title: "Sample audio clip",
				transcript: "This is a sample transcript for the audio content.",
			},
		},
		{
			id: "b-quote",
			type: "quote",
			data: {
				text: "Learning is not attained by chance, it must be sought for with ardor.",
				attribution: "Abigail Adams",
			},
		},
		{
			id: "b-divider",
			type: "divider",
			data: { dividerType: "line" },
		},
		{
			id: "b-table",
			type: "table",
			data: {
				headers: ["Feature", "Free", "Pro"],
				rows: [
					["Courses", "3", "Unlimited"],
					["Export", "SCORM 1.2", "All formats"],
				],
				caption: "Pricing comparison table",
			},
		},
		{
			id: "b-code-js",
			type: "code",
			data: {
				code: 'function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("Learner"));',
				language: "javascript",
				title: "Getting Started",
				showLineNumbers: true,
				startLine: 1,
			},
		},
		{
			id: "b-code-python",
			type: "code",
			data: {
				code: "def fibonacci(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a",
				language: "python",
				showLineNumbers: false,
			},
		},
		{
			id: "b-code-highlighted",
			type: "code",
			data: {
				code: "const config = {\n  host: 'localhost',\n  port: 3000,\n  debug: true,\n};",
				language: "javascript",
				title: "server.config.ts",
				showLineNumbers: true,
				highlightLines: [3, 4],
				startLine: 1,
			},
		},
		{
			id: "b-equation",
			type: "equation",
			data: { latex: "E = mc^2" },
			visible: true,
		},
		{
			id: "b-inline-math-text",
			type: "text",
			data: {
				content:
					'<p>The equation <span class="praxity-math-inline" data-math-latex="E=mc^2" contenteditable="false">E=mc^2</span> is fundamental.</p>',
			},
			visible: true,
		},
		{
			id: "b-embed",
			type: "embed",
			data: {
				src: "https://codepen.io/pen/embed/preview",
				title: "Interactive code example",
			},
		},
	],
};

const page2Interactive: PraxityPage = {
	id: "page-2-interactive",
	title: "Interactive Blocks",
	blocks: [
		{
			id: "b-accordion",
			type: "accordion",
			data: {
				items: [
					{
						id: "acc-1",
						label: "Section One",
						children: [
							{
								id: "acc-1-text",
								type: "text",
								data: {
									content: "<p>Content inside accordion section one.</p>",
								},
							},
						],
					},
					{
						id: "acc-2",
						label: "Section Two",
						children: [
							{
								id: "acc-2-text",
								type: "text",
								data: {
									content: "<p>Content inside accordion section two.</p>",
								},
							},
						],
					},
					{
						id: "acc-3",
						label: "Section Three",
						children: [
							{
								id: "acc-3-text",
								type: "text",
								data: {
									content: "<p>Content inside accordion section three.</p>",
								},
							},
						],
					},
				],
				allowMultipleOpen: true,
				trackCompletion: false,
			},
		},
		{
			id: "b-tabs",
			type: "tabs",
			data: {
				items: [
					{
						id: "tab-1",
						label: "Tab One",
						children: [
							{
								id: "tab-1-text",
								type: "text",
								data: {
									content: "<p>Content in the first tab panel.</p>",
								},
							},
						],
					},
					{
						id: "tab-2",
						label: "Tab Two",
						children: [
							{
								id: "tab-2-text",
								type: "text",
								data: {
									content: "<p>Content in the second tab panel.</p>",
								},
							},
						],
					},
					{
						id: "tab-3",
						label: "Tab Three",
						children: [
							{
								id: "tab-3-text",
								type: "text",
								data: {
									content: "<p>Content in the third tab panel.</p>",
								},
							},
						],
					},
				],
				tabPosition: "top",
				trackCompletion: false,
			},
		},
		{
			id: "b-sequence",
			type: "sequence",
			data: {
				variant: "numbered",
				orientation: "horizontal",
				items: [
					{
						id: "step-1",
						label: "Step One",
						children: [
							{
								id: "step-1-text",
								type: "text",
								data: { content: "<p>First step content.</p>" },
							},
						],
					},
					{
						id: "step-2",
						label: "Step Two",
						children: [
							{
								id: "step-2-text",
								type: "text",
								data: { content: "<p>Second step content.</p>" },
							},
						],
					},
				],
				trackCompletion: false,
			},
		},
		{
			id: "b-columns",
			type: "columns",
			data: {
				items: [
					{
						id: "col-1",
						label: "Column 1",
						children: [
							{
								id: "col-1-text",
								type: "text",
								data: { content: "<p>Left column content.</p>" },
							},
						],
					},
					{
						id: "col-2",
						label: "Column 2",
						children: [
							{
								id: "col-2-text",
								type: "text",
								data: { content: "<p>Right column content.</p>" },
							},
						],
					},
				],
				layout: "equal",
				gap: "medium",
				trackCompletion: false,
			},
		},
		{
			id: "b-card",
			type: "card",
			data: {
				layout: "single",
				items: [
					{
						id: "card-1",
						label: "",
						front: [
							{
								id: "card-1-front",
								type: "text",
								data: { content: "<p>What is WCAG?</p>" },
							},
						],
						back: [
							{
								id: "card-1-back",
								type: "text",
								data: { content: "<p>Web Content Accessibility Guidelines</p>" },
							},
						],
					},
					{
						id: "card-2",
						label: "",
						front: [
							{
								id: "card-2-front",
								type: "text",
								data: { content: "<p>What is ATAG?</p>" },
							},
						],
						back: [
							{
								id: "card-2-back",
								type: "text",
								data: { content: "<p>Authoring Tool Accessibility Guidelines</p>" },
							},
						],
					},
				],
			},
		},
		{
			id: "b-button",
			type: "button",
			data: {
				text: "Continue",
				href: "https://praxity.io",
				variant: "filled",
				openInNewTab: false,
				action: "link",
			},
		},
		{
			id: "b-rating",
			type: "rating",
			data: {
				label: "Rate this content",
				maxValue: 5,
				style: "stars",
			},
		},
		{
			id: "b-signature",
			type: "signature",
			data: {
				mode: "draw",
				label: "Sign here to confirm completion",
				required: false,
			},
		},
	],
};

const page3Assessment: PraxityPage = {
	id: "page-3-assessment",
	title: "Assessment & Flow",
	blocks: [
		{
			id: "b-mcq",
			type: "assessment",
			data: {
				assessmentType: "choice",
				stem: [
					{
						id: "mcq-stem",
						type: "text",
						data: {
							content: "<p>Which WCAG level is typically required for compliance?</p>",
						},
					},
				],
				response: {
					type: "choice",
					selectionMode: "single",
					inputMethod: "click",
					options: [
						{ id: "c1", label: "Level A", isCorrect: false },
						{ id: "c2", label: "Level AA", isCorrect: true },
						{ id: "c3", label: "Level AAA", isCorrect: false },
					],
					display: "list",
					shuffle: false,
				},
				feedback: {
					correct: [
						{
							id: "fb-correct",
							type: "text",
							data: {
								content: "<p>Correct! Level AA is the standard compliance target.</p>",
							},
						},
					],
					incorrect: [
						{
							id: "fb-incorrect",
							type: "text",
							data: {
								content: "<p>Not quite. Level AA is the most commonly required level.</p>",
							},
						},
					],
				},
				graded: true,
				points: 1,
				attempts: 2,
			},
		},
		{
			id: "b-matching",
			type: "assessment",
			data: {
				assessmentType: "matching",
				stem: [
					{
						id: "match-stem",
						type: "text",
						data: {
							content: "<p>Match the guideline to its scope:</p>",
						},
					},
				],
				response: {
					type: "matching",
					inputMethod: "drag",
					pairs: [
						{ id: "m1", prompt: "WCAG", correctMatch: "Web content" },
						{
							id: "m2",
							prompt: "ATAG",
							correctMatch: "Authoring tools",
						},
						{ id: "m3", prompt: "UAAG", correctMatch: "User agents" },
					],
				},
				feedback: {},
				graded: true,
				points: 1,
			},
		},
		{
			id: "b-text-response",
			type: "assessment",
			data: {
				assessmentType: "textResponse",
				stem: [
					{
						id: "tr-stem",
						type: "text",
						data: {
							content: "<p>Describe the purpose of alt text in your own words.</p>",
						},
					},
				],
				response: {
					type: "textResponse",
					inputType: "long",
					maxLength: 500,
				},
				feedback: {},
				graded: false,
			},
		},
		{
			id: "b-matrix",
			type: "assessment",
			data: {
				assessmentType: "matrix",
				stem: [
					{
						id: "matrix-stem",
						type: "text",
						data: { content: "<p>Rate your experience:</p>" },
					},
				],
				response: {
					type: "matrix",
					statements: [
						{
							id: "ls-1",
							text: "This course was accessible and easy to navigate.",
						},
					],
					scalePoints: [
						{ value: 1, label: "Strongly Disagree" },
						{ value: 2, label: "Disagree" },
						{ value: 3, label: "Neutral" },
						{ value: 4, label: "Agree" },
						{ value: 5, label: "Strongly Agree" },
					],
				},
				feedback: {},
				graded: false,
			},
		},
		{
			id: "b-variable",
			type: "variable",
			data: {
				variableName: "quizScore",
				dataType: "number",
				source: "author",
				defaultValue: 0,
			},
		},
		{
			id: "b-logic",
			type: "logic",
			data: {
				conditions: {
					operator: "and",
					rules: [
						{
							source: "b-mcq",
							field: "correct",
							comparison: "is",
							value: true,
						},
					],
				},
				actions: [{ type: "setVariable", target: "quizScore", value: 1 }],
			},
		},
	],
};

export const kitchenSinkCourse: CourseExportInput = {
	id: "kitchen-sink-a11y-test",
	title: "Kitchen Sink Accessibility Test Course",
	sourceLocale: "en",
	content: [page1Content, page2Interactive, page3Assessment],
	theme: {
		"--praxity-color-accent": "#2563eb",
		"--praxity-color-background": "#ffffff",
		"--praxity-color-text": "#1a1a1a",
		"--praxity-color-border": "#e5e7eb",
		"--praxity-font-family": "'Source Sans 3', sans-serif",
	},
};
