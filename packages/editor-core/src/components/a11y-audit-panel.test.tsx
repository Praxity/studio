import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "@praxity/grammar";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../__tests__/test-utils";
import { A11yAuditPanel } from "./a11y-audit-panel";
import { useGrammarDocumentStore } from "./grammar-document-store";

async function fixture(name: string): Promise<Uint8Array> {
	const packageRoot = process.cwd().endsWith("packages/editor-core")
		? process.cwd()
		: path.join(process.cwd(), "packages/editor-core");
	return readFile(path.join(packageRoot, "src/lib/a11y/__tests__/fixtures/gif-flash", name));
}

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
});

beforeEach(() => {
	useGrammarDocumentStore.setState({
		courseId: "course-1",
		parsedBlocks: [
			{
				id: "image-1",
				type: "image",
				data: { src: "/photo.jpg", altText: "image", decorative: false },
			},
		],
		frontmatter: { title: "Test course" },
		parseError: null,
	});
});

afterEach(cleanup);

it.each(["course", "lesson"])(
	"shows no font warnings in Check for saved pre-Next Clear %s settings",
	async (source) => {
		const saved = parseFrontmatter(
			"---\ntitle: Clear lesson\ndesign:\n  typography:\n    pairing: clear\n    fontDisplay: swap\n    code:\n      fontFamily: [monospace]\n    body:\n      fontFamily: [Atkinson Hyperlegible, sans-serif]\n      fontWeight: 400\n      fontStyle: normal\n    headings:\n      fontFamily: [Atkinson Hyperlegible, sans-serif]\n      fontWeight: 600\n      fontStyle: normal\n---\n",
		).frontmatter;
		const design = saved.design;
		useGrammarDocumentStore.setState({
			parsedBlocks: [{ id: "body", type: "text", data: { text: "Read clearly." } }],
			frontmatter: source === "lesson" ? saved : { title: "Clear lesson" },
		});
		renderWithProviders(<A11yAuditPanel courseDesign={source === "course" ? design : {}} />);
		expect(await screen.findByText(/^The available source checks found no issues/)).toBeTruthy();
		expect(screen.queryByText(/is ignored/)).toBeNull();
	},
);

it("shows course and frontmatter font warnings in Check without blocking export", async () => {
	useGrammarDocumentStore.setState({
		courseId: "ignored-fonts",
		frontmatter: parseFrontmatter(
			"---\ntitle: Font warnings\ndesign:\n  typography:\n    headings:\n      h2:\n        fontFamily: [Poppins]\n---\n",
		).frontmatter,
	});
	renderWithProviders(
		<A11yAuditPanel
			courseDesign={{ typography: { pairing: "book", body: { fontFamily: ["Inter"] } } }}
		/>,
	);
	expect(
		await screen.findByText(
			"design.typography.body.fontFamily is ignored. Courses use the Book pairing; set typography.pairing to sans, book or clear.",
		),
	).toBeTruthy();
	expect(
		await screen.findByText(
			"design.typography.headings.h2.fontFamily is ignored. Courses use the Book pairing; set typography.pairing to sans, book or clear.",
		),
	).toBeTruthy();
	act(() =>
		useGrammarDocumentStore.setState({
			frontmatter: parseFrontmatter(
				"---\ndesign:\n  typography:\n    pairing: clear\n    headings:\n      h2:\n        fontFamily: [Atkinson Hyperlegible Next]\n---\n",
			).frontmatter,
		}),
	);
	expect(
		await screen.findByText(
			"design.typography.body.fontFamily is ignored. Courses use the Clear pairing; set typography.pairing to sans, book or clear.",
		),
	).toBeTruthy();
	expect(
		screen.queryByText(
			"design.typography.headings.h2.fontFamily is ignored. Courses use the Book pairing; set typography.pairing to sans, book or clear.",
		),
	).toBeNull();
});

describe("A11yAuditPanel dismissal", () => {
	it("dismisses only for the current course session", async () => {
		const user = userEvent.setup();
		const firstPanel = renderWithProviders(<A11yAuditPanel />);
		expect(screen.queryByText("Start here")).toBeNull();
		expect(screen.queryByText("Start with the first critical or recommended finding.")).toBeNull();

		await user.click(screen.getByRole("button", { name: /^Dismiss:/ }));
		expect(screen.getByRole("button", { name: "Dismissed 1" })).toBeTruthy();

		firstPanel.unmount();
		renderWithProviders(<A11yAuditPanel />);
		expect(screen.getByRole("button", { name: "Dismissed 1" })).toBeTruthy();

		useGrammarDocumentStore.getState().setCourseId("course-2");
		expect(await screen.findByRole("button", { name: "Dismissed 0" })).toBeTruthy();
	});
});

describe("A11yAuditPanel card images", () => {
	it.each(["front", "back"])("identifies the image on a card %s face", async (face) => {
		useGrammarDocumentStore.setState({
			courseId: `card-${face}`,
			parsedBlocks: [
				{
					id: "cards",
					type: "card",
					data: {
						layout: "grid",
						items: [
							{
								front: [],
								back: [],
								[face]: [{ id: "card-image", type: "image", data: { src: "/picture.png" } }],
							},
						],
					},
				},
			],
		});
		renderWithProviders(<A11yAuditPanel />);
		expect((await screen.findAllByText("Image - picture.png")).length).toBeGreaterThan(0);
	});
});

describe("A11yAuditPanel media analysis", () => {
	it("waits for GIF analysis before showing a no-issues result", async () => {
		const bytes = await fixture("flashing.gif");
		let resolveAsset!: (value: Uint8Array) => void;
		const asset = new Promise<Uint8Array>((resolve) => {
			resolveAsset = resolve;
		});
		useGrammarDocumentStore.setState({
			courseId: "course-gif-pending",
			parsedBlocks: [
				{
					id: "gif-1",
					type: "image",
					data: { src: "/assets/flashing.gif", alt: "Alternating signal", decorative: false },
				},
			],
			frontmatter: { title: "GIF checks" },
			parseError: null,
		});

		renderWithProviders(
			<A11yAuditPanel
				gifFlashAnalysis={{
					cacheKey: "a11y-panel-gif-pending",
					readAsset: () => asset,
				}}
			/>,
		);

		expect(screen.getByText("Checking animated images for flashing…")).toBeTruthy();
		expect(screen.queryByText(/available source checks found no issues/)).toBeNull();

		resolveAsset(bytes);

		expect(await screen.findByRole("button", { name: /^Dismiss:/ })).toBeTruthy();
		expect(await screen.findByText("Animated image checks complete.")).toBeTruthy();
		await waitFor(() => {
			expect(screen.queryByText("Checking animated images for flashing…")).toBeNull();
		});
	});
});
