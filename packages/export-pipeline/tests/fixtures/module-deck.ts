import { readLesson } from "@praxity/grammar";
import { plainNarrationText } from "@praxity/shared-blocks/narration";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import type { CourseExportInput } from "../../src/build";

export function moduleDeckFixture(audio?: string, locale = "en"): CourseExportInput {
	const parsed = readLesson(
		"---\ntitle: Module deck\nlang: en\n---\n\n# Introduction\n\nBrief summary.\n\n# Practice {hideTitle}\n\n::: choice Which choice is helpful? {required attempts=2 level=3}\n(x) Ask what support is needed\nfeedback: Correct. Ask before assuming.\n( ) Make an assumption\nfeedback: Review the full script before trying again.\n:::\n\n# Certification {hideTitle}\n\n::: choice Which response respects choice? {required attempts=2 level=3}\n(x) Offer options\nfeedback: Correct. Offer options.\n( ) Decide for someone\nfeedback: Try again.\n:::\n\n# Read at your pace\nnav: Reading\n\n## Understanding the material\n\nThis longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. This longer slide remains readable without a fixed height. \n\n## Applying what you learned\n\n![An illustration of a city neighbourhood](https://deck.example/slide.webp)\n\n::: choice Would you like to review the material? {required=false}\n(x) Review the script\n( ) Continue to the next module\n:::\n",
	);
	const pages = splitBlocksIntoPages(parsed.blocks, "Module deck");
	const intro = pages[0].blocks.find((block) => block.type === "text");
	if (!intro) throw new Error("Missing introduction fixture");
	intro.data.narration =
		"This is the complete reading script. It explains more than the short summary on the slide. Reading remains available before narration is generated.";
	pages.forEach((page, index) => {
		page.id = `slide-${index + 1}`;
		page.lessonId = "module-one";
		page.lessonTitle = "Module one";
		page.isFirstPageOfLesson = index === 0;
		page.narrationEnabled = Boolean(audio);
		if (audio) {
			page.data = {
				...page.data,
				narrationAudio: audio.replace("fixture.mp3", `${index}-title.mp3`),
			};
			for (const block of page.blocks) {
				// N2 will migrate authored narration flags; preserve this fixture's two silent section headings at the model interface.
				if (index === 3 && block.type === "heading" && block.data.level === 2)
					block.data.narrationDisabled = true;
				if (block.type === "heading" && plainNarrationText(block.data.content) === page.title)
					continue;
				block.data = {
					...block.data,
					narrationAudio: audio.replace("fixture.mp3", `${index}-${block.id}.mp3`),
				};
			}
		}
	});
	if (audio)
		pages[3].blocks.push({
			id: "authored-audio",
			type: "audio",
			data: { src: audio, title: "Example audio", narrationDisabled: true },
		});
	const questions = pages
		.flatMap((page) => page.blocks)
		.filter((block) => block.type === "assessment");
	questions[0].id = "practice-gate";
	questions[1].id = "pass-gate";
	return {
		id: `module-deck-${audio ? "audio" : "reading"}-${locale}`,
		title: "Module deck",
		sourceLocale: locale,
		navigationStyle: "slides",
		navToggles: { navFloatingToc: true },
		moduleDeck: { gates: { "practice-gate": "attempt", "pass-gate": "pass" } },
		content: [
			...pages,
			{
				id: "module-two",
				lessonId: "module-two",
				lessonTitle: "Module two",
				isFirstPageOfLesson: true,
				title: "Next module",
				blocks: [
					{
						id: "next-text",
						type: "text",
						data: {
							content:
								'The second module starts paused. <a href="introduction.html#slide-3">Review certification</a>',
						},
					},
				],
			},
		],
	};
}

export function formattedDeckFixture(): CourseExportInput {
	const course = moduleDeckFixture("https://deck.example/fixture.mp3");
	course.id = "formatted-deck";
	course.title =
		"Module deck — Understanding telescope optics and maintenance in remote observatories";
	for (const page of course.content) {
		if (page.lessonId === "module-one")
			page.lessonTitle =
				"Module one — Working together to prepare accurate observations for every expedition";
	}
	course.navToggles = {
		...course.navToggles,
		navTopBar: true,
		navCourseTitle: true,
		navLessonTitles: true,
	};
	course.deckDesign = { initialPanel: "transcript", autoAdvance: false };
	const first = course.content[0];
	first.data = { ...first.data, narrationDisabled: true };
	for (const block of first.blocks) block.data.narrationDisabled = true;
	const reading = first.blocks.find((block) => block.type === "text");
	if (!reading) throw new Error("Missing reading fixture block");
	reading.data.narrationDisabled = false;
	reading.data.narrationAudio = "https://deck.example/formatted.wav";
	reading.data.narration =
		"# Reading context\n\n[sincerely] Read **with care** and *at your pace*.\n\n- [delighted] Ask for support.\n- Review the options.\n\n1. Choose a response.\n2. Continue when ready.";
	reading.data.narrationTimings = "https://deck.example/formatted.vtt";
	return course;
}

export function groupedDeckFixture(withFloatContext = false): CourseExportInput {
	const parsed = readLesson(
		"---\ntitle: Grouped deck\nlang: en\n---\n\n# Introduction\n\nReview the material, then complete a survey together on one page.\n\n# Survey {hideTitle}\n\n::: group Experience survey {mode=all requireAll showResultsSummary}\nbutton: Send survey\nRead this scenario before answering the questions below.\n::: choice Experience question 1 {scored=false required}\nConsider your experience of learning this topic. Choose the answer that best describes how confident you feel applying it in your work.\n( ) Confident 1\n( ) Need practice 1\n:::\n::: choice Experience question 2 {scored=false required}\nConsider your experience of learning this topic. Choose the answer that best describes how confident you feel applying it in your work.\n( ) Confident 2\n( ) Need practice 2\n:::\n::: choice Experience question 3 {scored=false required}\nConsider your experience of learning this topic. Choose the answer that best describes how confident you feel applying it in your work.\n( ) Confident 3\n( ) Need practice 3\n:::\n::: choice Experience question 4 {scored=false required}\nConsider your experience of learning this topic. Choose the answer that best describes how confident you feel applying it in your work.\n( ) Confident 4\n( ) Need practice 4\n:::\n::: choice Experience question 5 {scored=false required}\nConsider your experience of learning this topic. Choose the answer that best describes how confident you feel applying it in your work.\n( ) Confident 5\n( ) Need practice 5\n:::\n::: choice Experience question 6 {scored=false required}\nConsider your experience of learning this topic. Choose the answer that best describes how confident you feel applying it in your work.\n( ) Confident 6\n( ) Need practice 6\n:::\n:::\n\n# Knowledge check {hideTitle}\n\n::: group Choose your check {mode=oneOf passingScore=100}\nbutton: Submit chosen answer\n::: choice First scenario {required attempts=2}\n(x) Ask before helping\n( ) Assume support is wanted\n:::\n::: choice Second scenario {required attempts=2}\n(x) Offer a choice\n( ) Decide for someone\n:::\n:::\n\n# Continue learning\nnav: Reflection\n\nThe survey and selected knowledge check are complete.\n",
	);
	const pages = splitBlocksIntoPages(parsed.blocks, "Grouped deck");
	const intro = pages[0].blocks.find((block) => block.type === "text");
	if (!intro) throw new Error("Missing grouped introduction fixture");
	intro.data.narration = "Read the introduction before continuing to the survey.";
	const survey = pages[1].blocks.find((block) => block.type === "assessmentGroup");
	const check = pages[2].blocks.find((block) => block.type === "assessmentGroup");
	if (!survey || !check) throw new Error("Missing grouped fixture");
	survey.id = "experience-survey";
	survey.data.showResultsSummary = !withFloatContext;
	if (withFloatContext) {
		const context = pages[1].blocks.find((block) => block.type === "text");
		if (!context) throw new Error("Missing survey context");
		context.data.content = "<p>Consider this situation before answering the questions below.</p>";
		const position = pages[1].blocks.indexOf(context);
		pages[1].blocks.splice(position, 0, {
			id: "survey-context-image",
			type: "image",
			data: {
				src: "https://deck.example/context.webp",
				decorative: true,
				width: "medium",
				float: "right",
			},
		});
		pages[1].blocks.splice(position + 2, 0, {
			id: "survey-context-end",
			type: "blockBreak",
			data: { close: "float" },
		});
	}
	check.id = "chosen-check";
	pages.forEach((page, index) => {
		page.id = `group-slide-${index + 1}`;
		page.lessonId = "group-module";
		page.lessonTitle = "Grouped module";
		page.isFirstPageOfLesson = index === 0;
	});
	return {
		id: "grouped-module-deck",
		title: "Grouped deck",
		sourceLocale: "en",
		navigationStyle: "slides",
		moduleDeck: { gates: { "experience-survey": "attempt", "chosen-check": "pass" } },
		content: pages,
	};
}
