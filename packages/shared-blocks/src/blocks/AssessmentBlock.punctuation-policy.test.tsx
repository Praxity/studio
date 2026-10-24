import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocalStorageRuntime } from "../../../export-pipeline/src/scorm/local-storage-runtime";
import type { CourseHostConfig } from "../../../export-pipeline/template/src/hosts/course-host";
import { createPrivateBlockStateRuntime } from "../../../export-pipeline/template/src/hosts/private-block-state";
import { readBlockFixture } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import type { LearnerStateValue } from "../learner-state";
import type { AssessmentBlockData } from "../types";
import { PreviewAssessmentBlock } from "./AssessmentBlock";

afterEach(() => {
	cleanup();
	delete window.__praxityBlockState;
	localStorage.clear();
});

function fixture(style: "typed" | "dropdown" | "word-bank", source: string, distractor = "wrong") {
	const lesson = readBlockFixture(
		`# Fixture {hideTitle}\n\n::: fill-blank Choose {style=${style} scored attempts=3}\n` +
			(style === "word-bank" ? `bank: ${source} | ${distractor}\n` : "") +
			`\nPick {${style === "dropdown" ? `*${source}|${distractor}` : source}}.\n:::\n`,
	);
	expect(lesson.errors).toEqual([]);
	const block = lesson.blocks[0];
	const data = block.data as unknown as AssessmentBlockData;
	if (data.response.type !== "fillBlank") throw new Error("Expected blanks");
	const blankId = data.response.blanks[0].id;
	const runtime = new LocalStorageRuntime(localStorage, "course", "attempt", "build-before");
	const mount = () => {
		window.__praxityBlockState = createPrivateBlockStateRuntime(
			new LocalStorageRuntime(localStorage, "course", "attempt", "build-after"),
			{ courseId: "course", strings: {} } as CourseHostConfig,
			window,
		);
		return render(
			<MantineProvider>
				<PreviewAssessmentBlock data={data} blockId={block.id} />
			</MantineProvider>,
		);
	};
	const save = (value: string, correct: boolean) =>
		runtime.setBlockState(block.id, {
			version: 1,
			kind: "assessment",
			assessmentType: "fillBlank",
			answer: { [blankId]: value },
			attemptCount: 1,
			checked: true,
			correct,
			completed: correct,
			interacted: true,
		});
	return {
		mount,
		save,
		state: () => runtime.getBlockState(block.id),
		blockId: block.id,
		blankId,
	};
}

it.each(["typed", "dropdown", "word-bank"] as const)(
	"keeps the compatibility spelling and completed saved %s answer",
	(style) => {
		const { mount, save, state, blockId } = fixture(style, String.raw`a\,b`);
		save(String.raw`a\,b`, true);
		const before = state();
		const { container } = mount();
		expect(screen.getByRole(style === "typed" ? "textbox" : "combobox")).toHaveValue(
			String.raw`a\,b`,
		);
		expect(container.querySelector(`[data-block-id="${blockId}"]`)).toHaveAttribute(
			"data-completed",
			"true",
		);
		expect(container.querySelector(".praxity-fill-blank-status")).toHaveAttribute(
			"data-result",
			"correct",
		);
		expect(state()).toEqual(before);
	},
);

it.each(["dropdown", "word-bank"] as const)(
	"restores the correct %s choice when a future decoding rule would collide with its distractor",
	(style) => {
		const { mount, save, state } = fixture(style, String.raw`a\,b`, String.raw`a\\\,b`);
		save(String.raw`a\,b`, true);
		mount();
		expect(screen.getByRole("combobox")).toHaveValue(String.raw`a\,b`);
		expect(
			screen.getAllByRole("option").map((option) => (option as HTMLOptionElement).value),
		).toEqual(["", String.raw`a\,b`, String.raw`a\\,b`]);
		expect(state()).toMatchObject({ attemptCount: 1, correct: true, completed: true });
		expect(document.querySelector(".praxity-fill-blank-status")).toHaveAttribute(
			"data-result",
			"correct",
		);
	},
);

it.each([
	[String.raw`MiXeD\,  Text`, "  MIXED\\,\tTEXT  "],
	["Cafe\u0301\\%", "  CAF\u00c9\\%  "],
] as const)(
	"restores %s without changing learner casing, NFC spelling or whitespace",
	(source, value) => {
		const { mount, save, state } = fixture("typed", source);
		save(value, true);
		mount();
		expect(screen.getByRole("textbox")).toHaveValue(value);
		expect(state()).toMatchObject({ attemptCount: 1, correct: true, completed: true });
	},
);

it.each([
	[String.raw`a\,b`, true],
	["a,b", false],
] as const)(
	"saves and reloads literal learner answer %s with its existing result",
	(value, correct) => {
		const { mount, state, blankId, blockId } = fixture("typed", String.raw`a\,b`);
		const first = mount();
		fireEvent.change(screen.getByRole("textbox"), { target: { value } });
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
		const saved = state();
		expect(saved).toMatchObject({
			answer: { [blankId]: value },
			correct,
			completed: correct,
			attemptCount: 1,
		});
		first.unmount();
		const { container } = mount();
		expect(screen.getByRole("textbox")).toHaveValue(value);
		expect(container.querySelector(`[data-block-id="${blockId}"]`)).toHaveAttribute(
			"data-result",
			correct ? "correct" : "incorrect",
		);
		expect(container.querySelector(`[data-block-id="${blockId}"]`)).toHaveAttribute(
			"data-attempted",
			"true",
		);
		expect(state()).toEqual(saved);
	},
);

it.each([String.raw`a\,b`, "learner\\,text\\q\\"])("keeps the literal saved draft %s", (value) => {
	const { mount, state, blankId } = fixture("typed", String.raw`a\,b`);
	const first = mount();
	fireEvent.change(screen.getByRole("textbox"), { target: { value } });
	const saved: LearnerStateValue | undefined = state();
	expect(saved).toMatchObject({ answer: { [blankId]: value }, checked: false, attemptCount: 0 });
	first.unmount();
	mount();
	expect(screen.getByRole("textbox")).toHaveValue(value);
	expect(state()).toEqual(saved);
});

it("retains an existing wrong attempt that the later ASCII answer key would accept", () => {
	const { mount, save, state, blockId } = fixture("typed", String.raw`a\,b`);
	save("a,b", false);
	const before = state();
	const { container } = mount();
	expect(screen.getByRole("textbox")).toHaveValue("a,b");
	expect(container.querySelector(`[data-block-id="${blockId}"]`)).toHaveAttribute(
		"data-result",
		"incorrect",
	);
	expect(state()).toEqual(before);
});
