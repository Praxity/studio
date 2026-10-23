import { MantineProvider } from "@mantine/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewAssessmentBlock } from "../blocks/AssessmentBlock";
import { getStrings } from "../i18n/strings";
import type { BlockLayoutMode, PraxityBlock } from "../types";
import { initAssessmentGroups } from "./assessment-group-runtime";

afterEach(cleanup);

const journalBlocks = [
	{
		id: "journal",
		type: "assessmentGroup",
		data: {
			groupName: "Journal",
			memberBlockIds: ["reflection", "plan"],
			showResultsSummary: false,
		},
	},
	...["reflection", "plan"].map((id) => ({
		id,
		type: "assessment",
		data: {
			assessmentType: "textResponse",
			stem: [{ id: `${id}-stem`, type: "text", data: { content: `<p>${id}</p>` } }],
			response: { type: "textResponse", inputType: "short", downloadAs: "both" },
			feedback: {},
			gradingMode: "none",
			required: true,
		},
	})),
] as PraxityBlock[];

function JournalHarness({ optionalPlan = false }: { optionalPlan?: boolean }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const blocks = optionalPlan
		? journalBlocks.map((block) =>
				block.id === "plan" ? { ...block, data: { ...block.data, required: false } } : block,
			)
		: journalBlocks;
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		return initAssessmentGroups({ blocks, root, labels: getStrings("en") });
	}, [blocks]);
	return (
		<MantineProvider>
			<div ref={rootRef}>
				<div data-assessment-group-header="journal">
					<h2 className="praxity-assessment-group-title">Journal</h2>
				</div>
				{blocks.slice(1).map((block) => (
					<div
						className="praxity-block praxity-block-assessment"
						data-block-id={block.id}
						key={block.id}
					>
						<PreviewAssessmentBlock
							data={block.data as never}
							blockId={block.id}
							groupedDownloadSubmit
						/>
					</div>
				))}
			</div>
		</MantineProvider>
	);
}

it("saves the required response and completes with an optional response empty", async () => {
	const values = new Map<string, unknown>();
	window.__praxityBlockState = {
		get: (id) => values.get(id) as never,
		set: (id, value) => values.set(id, value),
	};
	const view = render(<JournalHarness optionalPlan />);
	fireEvent.change(screen.getByRole("textbox", { name: /reflection/i }), {
		target: { value: "Think today" },
	});
	fireEvent.click(await screen.findByRole("button", { name: "Check all" }));
	await waitFor(() => expect(values.get("journal")).toMatchObject({ completed: true }));
	expect(values.get("reflection")).toMatchObject({ answer: "Think today", completed: true });
	expect(values.get("plan")).toBeUndefined();
	expect(screen.getByRole("textbox", { name: /plan/i })).toHaveValue("");
	view.unmount();
	delete window.__praxityBlockState;
});

it("saves one journal answer and restores it before the required plan is answered", async () => {
	const values = new Map<string, unknown>();
	window.__praxityBlockState = {
		get: (id) => values.get(id) as never,
		set: (id, value) => values.set(id, value),
	};
	const first = render(<JournalHarness />);
	fireEvent.change(screen.getByRole("textbox", { name: /reflection/i }), {
		target: { value: "Think today" },
	});
	fireEvent.click(await screen.findByRole("button", { name: "Check all" }));
	await waitFor(() =>
		expect(values.get("reflection")).toMatchObject({
			answer: "Think today",
			checked: true,
			completed: true,
		}),
	);
	expect(values.get("plan")).toBeUndefined();
	expect(values.get("journal")).not.toMatchObject({ completed: true });
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i));
	first.unmount();
	render(<JournalHarness />);
	expect(screen.getByRole("textbox", { name: /reflection/i })).toHaveValue("Think today");
	expect(screen.getByRole("textbox", { name: /plan/i })).toHaveValue("");
	fireEvent.change(screen.getByRole("textbox", { name: /plan/i }), {
		target: { value: "Act tomorrow" },
	});
	fireEvent.click(await screen.findByRole("button", { name: "Check all" }));
	await waitFor(() => expect(values.get("journal")).toMatchObject({ completed: true }));
	expect(values.get("plan")).toMatchObject({
		answer: "Act tomorrow",
		checked: true,
		completed: true,
	});
	expect(document.querySelectorAll("[data-assessment-group-download] button")).toHaveLength(2);
	expect(document.querySelector(".praxity-ag-submit-btn")).toBeNull();
	expect(screen.getByRole("status")).toBeEmptyDOMElement();
	delete window.__praxityBlockState;
});

function Harness({
	onlyOpen = false,
	rerenderOnSubmit = false,
	showResultsSummary = true,
	buttonLabel,
	groupLayout,
	gradedLayout,
}: {
	onlyOpen?: boolean;
	rerenderOnSubmit?: boolean;
	showResultsSummary?: boolean;
	buttonLabel?: string;
	groupLayout?: BlockLayoutMode;
	gradedLayout?: BlockLayoutMode;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [, setRevision] = useState(0);
	const commit = (button: HTMLButtonElement) => {
		button.parentElement?.setAttribute("data-completed", "true");
		if (rerenderOnSubmit) setRevision((revision) => revision + 1);
	};
	const blocks = [
		{
			id: "group-1",
			type: "assessmentGroup",
			data: {
				groupName: "Safety check",
				mode: "all",
				memberBlockIds: onlyOpen ? ["open"] : ["graded", "open"],
				requireAll: false,
				showResultsSummary,
				passingScore: 80,
				buttonLabel,
				layoutMode: groupLayout,
			},
		},
		...(!onlyOpen ? [{ id: "graded", type: "assessment", data: { gradingMode: "exact" } }] : []),
		{ id: "open", type: "assessment", data: { gradingMode: "none" } },
	] as PraxityBlock[];

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		return initAssessmentGroups({ blocks, root, labels: getStrings("en") });
	}, [blocks]);
	return (
		<>
			<div ref={rootRef}>
				<fieldset
					aria-labelledby="group-title group-progress"
					data-assessment-group-header="group-1"
				>
					<h2 id="group-title">Safety check</h2>
					<p id="group-progress" data-assessment-group-progress>
						Questions completed: 0 of {onlyOpen ? 1 : 2}
					</p>
				</fieldset>
				{!onlyOpen && (
					<div
						className={`praxity-block praxity-block-assessment${gradedLayout ? ` praxity-layout-${gradedLayout}` : ""}`}
						data-block-id="graded"
					>
						<div
							className="praxity-block-assessment"
							data-block-id="graded"
							data-assessment-display="standard"
							data-score="100"
							data-max-score="100"
							data-passed="true"
						>
							<button
								type="button"
								data-assessment-submit="true"
								onClick={(event) => commit(event.currentTarget)}
							>
								Submit
							</button>
						</div>
					</div>
				)}
				<div className="praxity-block praxity-block-assessment" data-block-id="open">
					<div
						className="praxity-block-assessment"
						data-block-id="open"
						data-assessment-display="standard"
					>
						<button
							type="button"
							data-assessment-submit="true"
							onClick={(event) => commit(event.currentTarget)}
						>
							Check
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

describe("assessment group initializer", () => {
	it("excludes an ungradable member from the group percentage", async () => {
		const onComplete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", onComplete);
		render(<Harness rerenderOnSubmit />);

		const submit = await screen.findByRole("button", { name: "Submit all" });
		const members = document.querySelectorAll<HTMLElement>("[data-assessment-group='group-1']");
		expect(members[0]).toHaveAttribute("data-group-first");
		expect(members[0]).not.toHaveAttribute("data-group-last");
		expect(members[1]).toHaveAttribute("data-group-last");
		expect(members[1]).toHaveAttribute("data-group-has-footer");
		const initialResults = document.querySelector("[data-assessment-group-results]");
		if (!initialResults) throw new Error("Missing group results");
		expect(initialResults).toBeEmptyDOMElement();
		fireEvent.click(submit);

		await waitFor(() => expect(screen.getByText(/Score: 100% - Passed/)).toBeInTheDocument());
		expect(screen.getByText("Questions completed: 2 of 2")).toBeInTheDocument();
		expect(screen.getByRole("group", { name: /Safety check/ })).toHaveAccessibleName(
			"Safety check Questions completed: 2 of 2",
		);
		expect(screen.queryByRole("button", { name: "Submit all" })).not.toBeInTheDocument();
		expect(initialResults.isConnected).toBe(false);
		expect(document.querySelector("[data-assessment-group-results]")).toHaveTextContent(
			/Score: 100% - Passed/,
		);
		expect(screen.getByRole("status")).toBeEmptyDOMElement();
		expect(members[1]).toHaveAttribute("data-group-has-footer");
		expect(onComplete).toHaveBeenCalledWith(
			expect.objectContaining({
				detail: expect.objectContaining({ score: 100, passed: true, memberCount: 2 }),
			}),
		);
		document.removeEventListener("praxity:assessment-group-complete", onComplete);
	});

	it("does not finish a pending submission after unmount", async () => {
		const onComplete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", onComplete);
		try {
			const { unmount } = render(<Harness />);
			const submit = await screen.findByRole("button", { name: "Submit all" });
			vi.useFakeTimers();
			fireEvent.click(submit);
			unmount();
			act(() => vi.advanceTimersByTime(100));
			expect(onComplete).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
			document.removeEventListener("praxity:assessment-group-complete", onComplete);
		}
	});

	it("does not score detached members in a retained group root", async () => {
		const onComplete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", onComplete);
		try {
			const { container } = render(<Harness />);
			const submit = await screen.findByRole("button", { name: "Submit all" });
			vi.useFakeTimers();
			const root = container.querySelector(
				'[data-assessment-group-header="group-1"]',
			)?.parentElement;
			fireEvent.click(submit);
			const graded = root?.querySelector('[data-block-id="graded"]');
			if (!root || !graded) throw new Error("Missing assessment group member");
			graded.replaceWith(graded.cloneNode(true));
			expect(root.isConnected).toBe(true);
			act(() => vi.advanceTimersByTime(100));
			expect(screen.getByRole("status")).toBeEmptyDOMElement();
			expect(document.querySelector("[data-assessment-group-results]")).toBeEmptyDOMElement();
			expect(screen.getByText("Questions completed: 0 of 2")).toBeInTheDocument();
			expect(onComplete).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
			document.removeEventListener("praxity:assessment-group-complete", onComplete);
		}
	});

	it("moves the rounded end back to the last member when no results footer remains", async () => {
		render(<Harness onlyOpen showResultsSummary={false} />);

		const submit = await screen.findByRole("button", { name: "Check all" });
		const member = document.querySelector<HTMLElement>("[data-block-id='open']");
		expect(member).toHaveAttribute("data-group-has-footer");
		fireEvent.click(submit);

		await waitFor(() => {
			expect(document.querySelector("[data-assessment-group-submit]")).not.toBeInTheDocument();
		});
		expect(member).toHaveAttribute("data-group-last");
		expect(member).not.toHaveAttribute("data-group-has-footer");
	});

	it("completes an entirely ungradable group without emitting a score", async () => {
		const onComplete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", onComplete);
		render(<Harness onlyOpen />);

		fireEvent.click(await screen.findByRole("button", { name: "Check all" }));

		await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
		const event = onComplete.mock.calls[0]?.[0] as CustomEvent | undefined;
		expect(event?.detail).toEqual(expect.objectContaining({ passed: true, memberCount: 1 }));
		expect(event?.detail).not.toHaveProperty("score");
		document.removeEventListener("praxity:assessment-group-complete", onComplete);
	});

	it("uses an authored group button label", async () => {
		render(<Harness onlyOpen buttonLabel="Keep responses" />);

		expect(await screen.findByRole("button", { name: "Keep responses" })).toBeInTheDocument();
	});

	it("uses the group width for every member and restores authored widths on cleanup", async () => {
		const { unmount } = render(<Harness groupLayout="wide" gradedLayout="full" />);

		await screen.findByRole("button", { name: "Submit all" });
		const graded = document.querySelector<HTMLElement>("[data-block-id='graded']");
		const open = document.querySelector<HTMLElement>("[data-block-id='open']");
		const footer = document.querySelector<HTMLElement>("[data-assessment-group-submit]");
		expect(graded).toHaveClass("praxity-layout-wide");
		expect(graded).not.toHaveClass("praxity-layout-full");
		expect(open).toHaveClass("praxity-layout-wide");
		expect(footer).toHaveClass("praxity-layout-wide");
		unmount();
		expect(graded).toHaveClass("praxity-layout-full");
		expect(graded).not.toHaveClass("praxity-layout-wide");
	});
});
