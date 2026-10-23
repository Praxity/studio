import en from "@praxity/editor-core/messages/en";
import { createSession, dispatch } from "@praxity/editor-core/session";
import { readLesson } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { expect, it, vi } from "vitest";
import { largeSnapshotFixture } from "../../main/__tests__/fixtures/editor-snapshot";
import { editorLessonOutline, editorLessonProjection, readEditorLesson } from "../editor-session";

vi.mock("@praxity/grammar", async (original) => {
	const actual = await original<typeof import("@praxity/grammar")>();
	return { ...actual, readLesson: vi.fn(actual.readLesson) };
});
const translator = createTranslator({ locale: "en", messages: en });
const translate = (key: string, params?: Record<string, string | number>) =>
	translator(key as Parameters<typeof translator>[0], params);
const lessonOf = (source: string) => largeSnapshotFixture(source).lessons[0];

it.each(["commit reply", "outside change", "file switch"])(
	"D3 %s parses the admitted source exactly once",
	(change) => {
		let lesson = lessonOf("# Before\n\nText\n");
		const session = createSession();
		editorLessonOutline(lesson, session, translate);
		lesson = lessonOf("# After\n\nNew text\n");
		if (change === "file switch") lesson.file = "b.prax";
		vi.mocked(readLesson).mockClear();
		expect(editorLessonOutline(lesson, session, translate).pages[0].nodes[0].id).toBe(
			lesson.nodes[0].id,
		);
		expect(readEditorLesson(lesson).tree.stream.source).toBe("# After\n\nNew text\n");
		const projection = editorLessonProjection(lesson, session, translate);
		expect(
			projection.readDraft({ file: lesson.file, nodeId: lesson.nodes[1].id, role: "handle" })
				.expectedText,
		).toBe("New text\n");
		expect(projection.selectionNodes().map((n) => n.id)).toEqual(lesson.nodes.map((n) => n.id));
		expect(readLesson).toHaveBeenCalledTimes(1);
	},
);

it("D3 cached and fresh reads agree across exact-byte and binding mutations", () => {
	const lesson = lessonOf("# First\n\nText\n\n# Other\n\nBody\n");
	const check = () => {
		// Independent uncached admission precedes warming this exact object/revision.
		const fresh = readEditorLesson(structuredClone(lesson));
		vi.mocked(readLesson).mockClear();
		expect(readEditorLesson(lesson)).toEqual(fresh);
		expect(readEditorLesson(lesson)).toEqual(fresh);
		expect(readLesson).toHaveBeenCalledTimes(1);
	};
	check();
	// Same byte length and same revision, with no wall-clock advance or watcher.
	lesson.source = lesson.source.replace("Text", "Next");
	check();
	lesson.source = lesson.source.replace("Next", "Text");
	check();
	// Another page's definition is part of the admitted source too.
	lesson.source = lesson.source.replace("Body", "Else");
	check();
	lesson.baseRevision = "1".repeat(64);
	check();
	lesson.file = "b.prax";
	check();
	lesson.nodes[1].id = "retargeted-node";
	check();
	lesson.nodes[1].id = "restored-node";
	check();
	// A consumer cannot corrupt the private parsed tree or allocated identity map.
	const exposed = readEditorLesson(lesson);
	exposed.tree.root.children.length = 0;
	exposed.nodes.clear();
	expect(readEditorLesson(lesson).nodes.size).toBeGreaterThan(0);
	expect(readEditorLesson(lesson).tree.root.children).toHaveLength(2);
});

it("D3 admitted parses do not retain mutable translation hooks or session projections", () => {
	const lesson = lessonOf("# First\n\nText\n");
	const state = createSession();
	let suffix = "before";
	const hook = (key: string) => `${key}:${suffix}`;
	const before = editorLessonOutline(lesson, state, hook);
	suffix = "after";
	const after = editorLessonOutline(lesson, state, hook);
	expect(after.pages[0].nodes[0].name).not.toBe(before.pages[0].nodes[0].name);
	state.selected = [lesson.nodes[1].id];
	expect(editorLessonOutline(lesson, state, hook).pages[0].selected).toEqual([lesson.nodes[1].id]);
});

it.each(["absent", "empty", "page", "frontmatter", "multiple pages"])(
	"D3 model typing and admission histories start %s",
	(start) => {
		for (const seed of [7, 41, 1585, 65537]) {
			let random = seed;
			const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
			const initialSource =
				start === "empty"
					? ""
					: start === "frontmatter"
						? "---\ntitle: First\n---\n# First\n\nText\n"
						: start === "multiple pages"
							? "# First\n\nText\n\n# Other\n\nBody\n"
							: "# First\n\nText\n";
			let lesson = start === "absent" ? undefined : lessonOf(initialSource);
			let expectedSource = start === "absent" ? undefined : initialSource;
			let expectedTitle = "Page: First";
			let expectedBody = "Text\n";
			let expectedParses = 0;
			let unread = !!lesson;
			let state = createSession();
			vi.mocked(readLesson).mockClear();
			for (let step = 0; step < 40; step++) {
				// Spec model: only an admitted replacement creates one new parsed snapshot.
				if (!lesson || next() % 3 === 0) {
					expectedTitle = `Page: Title ${step}`;
					expectedBody = `Body ${step}\n`;
					expectedSource = `# Title ${step}\n\nBody ${step}\n`;
					lesson = lessonOf(expectedSource);
					if (next() % 2) lesson.file = "b.prax";
					unread = true;
					state = createSession();
				}
				if (unread) {
					expectedParses++;
					unread = false;
				}
				const admitted = lesson;
				const projection = () => editorLessonProjection(admitted, state, translate);
				const nodes = projection().selectionNodes();
				if (lesson.nodes.length > 1) {
					const focus = { file: lesson.file, nodeId: lesson.nodes[1].id, role: "handle" as const };
					const deps = () => ({
						...projection(),
						now: step * 100,
						translate: (m: { key: string }) => m.key,
						validateDraft: () => ({ diagnostics: [], escapes: false }),
						helperTokens: () => [],
						focusNeighbours: () => ({ page: { ...focus, nodeId: admitted.nodes[0].id } }),
					});
					state = dispatch(
						state,
						{ type: "openSource", seed: projection().readDraft(focus) },
						deps(),
					).state;
					for (let key = 0, count = (next() % 12) + 1; key < count; key++) {
						state = dispatch(
							state,
							{ type: "changeDraft", text: `draft ${step}:${key}`, selection: [0, 0] },
							deps(),
						).state;
						expect(
							editorLessonOutline(lesson, state, translate).pages.flatMap((p) =>
								p.nodes.map((n) => n.id),
							),
						).toEqual(nodes.map((n) => n.id));
						expect(projection().readDraft(focus).expectedText).toBe(expectedBody);
						expect(projection().nameOfFocus({ ...focus, nodeId: lesson.nodes[0].id })).toBe(
							expectedTitle,
						);
						expect(editorLessonOutline(lesson, state, translate).pages[0].nodes[0].name).toBe(
							expectedTitle,
						);
						expect(readLesson).toHaveBeenCalledTimes(expectedParses);
					}
				}
				expect(readEditorLesson(lesson).tree.stream.source).toBe(expectedSource);
				expect(readLesson).toHaveBeenCalledTimes(expectedParses);
			}
		}
	},
);
