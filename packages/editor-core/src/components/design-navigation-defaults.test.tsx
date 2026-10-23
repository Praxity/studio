import { resolveDeckDesign, serializeFrontmatter } from "@praxity/grammar";
import { getNavPreset } from "@praxity/grammar/src/nav-archetype-presets.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { renderWithProviders as renderWithEditorProviders } from "../__tests__/test-utils";
import { DEFAULT_DESIGN_VARIANTS } from "../lib/themes/design-variant-defaults";
import { DesignSystemPanel } from "./design-system-panel";
import { useGrammarDocumentStore } from "./grammar-document-store";

vi.mock("../lib/themes/load-font", () => ({ loadFont: vi.fn() }));
vi.mock("./theme-preview-thumbnail", () => ({ ThemePreviewThumbnail: () => null }));
vi.mock("./panel-chrome/panel-accordion", async () => ({
	PanelAccordion: (await import("./__tests__/lazy-panel-accordion")).LazyPanelAccordion,
}));

function renderWithProviders(ui: React.ReactElement) {
	return renderWithEditorProviders(ui, { env: "test", withCssVariables: false });
}

it.each([false, true])(
	"presentation edits and resets retain learner-flow inheritance from course ordering %s",
	(courseOrder) => {
		useGrammarDocumentStore.getState().setParsedResult([], {});
		renderWithProviders(
			<DesignSystemPanel
				moduleDeck
				courseDeck={{ sequentialLessons: courseOrder, autoAdvance: true, followNarration: false }}
			/>,
		);
		fireEvent.click(screen.getByRole("switch", { name: "Include links to other modules" }));
		const savedDeck = () =>
			readBlockSource(
				serializeFrontmatter({
					design: useGrammarDocumentStore.getState().designVariants,
				} as never),
			).frontmatter.design?.deck;
		expect(savedDeck()).toEqual({ preset: "custom", outlineDetail: "currentModule" });
		expect(
			resolveDeckDesign({
				sequentialLessons: !courseOrder,
				autoAdvance: false,
				followNarration: true,
				...savedDeck(),
			}),
		).toMatchObject({ sequentialLessons: !courseOrder, autoAdvance: false, followNarration: true });
		fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));
		for (const key of ["sequentialLessons", "autoAdvance", "followNarration"])
			expect(savedDeck()).not.toHaveProperty(key);
		expect(
			resolveDeckDesign({ sequentialLessons: !courseOrder, ...savedDeck() }).sequentialLessons,
		).toBe(!courseOrder);
	},
);

beforeEach(() => {
	HTMLElement.prototype.scrollIntoView = vi.fn();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callback(0));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		},
	);
	window.matchMedia = vi
		.fn()
		.mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
	useGrammarDocumentStore.setState({
		designVariants: DEFAULT_DESIGN_VARIANTS,
		frontmatter: {},
		_designDirty: false,
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const controls = [
	["Accordion", "style", "Primary", "accordion", "style", "primary"],
	["Tabs", "style", "Pills", "tabs", "style", "pills"],
	["Tabs", "orientation", "Vertical", "tabs", "orientation", "vertical"],
	["Card", "layout", "Slides", "card", "layout", "slides"],
	["Card", "style", "Shaded", "card", "style", "shaded"],
	["Card", "shadow", "Elevated", "card", "shadow", "elevated"],
	["Card", "transition", "Slide", "card", "transition", "slide"],
	["Sequence", "style", "None", "sequence", "style", "none"],
	["Sequence", "orientation", "Horizontal", "sequence", "orientation", "horizontal"],
	["Sequence", "alignment", "Right", "sequence", "alignment", "right"],
	["Comparison", "layout", "Slider", "comparison", "layout", "slider"],
	["Rating", "style", "Stars", "rate", "style", "stars"],
	["Assessment Group", "mode", "OneOf", "assessment-group", "mode", "oneOf"],
	["Signature", "mode", "Type", "signature", "mode", "type"],
] as const;
it.each(controls)(
	"persists %s %s from the actual default control",
	async (_label, axis, option, keyword, field, expected) => {
		renderWithProviders(<DesignSystemPanel />);
		fireEvent.click(screen.getByRole("button", { name: "Block Style Defaults" }));
		const input = document.querySelector<HTMLInputElement>(
			`[id$="component-default-${keyword}-${axis}"]`,
		);
		if (!input) throw new Error(`Missing ${keyword} ${axis} control`);
		fireEvent.click(input);
		fireEvent.click(await screen.findByRole("option", { name: option }));
		const design = useGrammarDocumentStore.getState().designVariants;
		expect(design.componentDefaults[keyword]).toMatchObject({ [field]: expected });
		const saved = serializeFrontmatter({ design } as never);
		expect(readBlockSource(saved).frontmatter.design?.componentDefaults?.[keyword]).toMatchObject({
			[field]: expected,
		});
	},
);
it("offers exactly fourteen meaningful default selectors", () => {
	renderWithProviders(<DesignSystemPanel />);
	fireEvent.click(screen.getByRole("button", { name: "Block Style Defaults" }));
	expect(document.querySelectorAll('[id*="component-default-"][role="combobox"]')).toHaveLength(14);
});

it("keeps blank response modes in question completions, not course style defaults", () => {
	renderWithProviders(<DesignSystemPanel />);
	fireEvent.click(screen.getByRole("button", { name: "Block Style Defaults" }));
	expect(document.querySelector('[id$="component-default-fill-blank-style"]')).toBeNull();
	expect(getDefinition("fill-blank")?.settings.style.values).toEqual([
		"typed",
		"word-bank",
		"dropdown",
	]);
});

it.each(["dropdown", "word-bank"])(
	"ignores inherited %s response mode and bank without changing typed answers",
	(style) => {
		const defaults = {
			"fill-blank": { style, bank: "colour | color" },
			assessment: { style, bank: "colour | color" },
		};
		const source =
			"# Untitled {hideTitle}\n\n::: fill-blank Complete {level=3}\nThe {colour|color}.\n:::\n";
		for (const settings of [defaults, { assessment: defaults.assessment }]) {
			const [block] = adaptGrammarPreviewBlocks(readBlockSource(source).blocks, settings);
			expect(block.data.response).toMatchObject({
				type: "fillBlank",
				blanks: [{ answer: "colour", alternatives: ["color"] }],
			});
			expect(block.data.response).not.toHaveProperty("style");
			expect(block.data.response).not.toHaveProperty("wordBank");
		}
		const authored = style === "dropdown" ? "The {red|*blue}." : "bank: blue | red\nThe {blue}.";
		const [explicit] = adaptGrammarPreviewBlocks(
			readBlockSource(`::: fill-blank Complete {style=${style} level=3}\n${authored}\n:::\n`)
				.blocks,
			defaults,
		);
		expect(explicit.data.response).toMatchObject({ style, blanks: [{ answer: "blue" }] });
	},
);

it("keeps the omitted accordion fallback distinct from explicit none", () => {
	renderWithProviders(<DesignSystemPanel />);
	fireEvent.click(screen.getByRole("button", { name: "Block Style Defaults" }));
	const input = document.querySelector<HTMLInputElement>(
		'[id$="component-default-accordion-style"]',
	);
	expect(input?.value).toBe("");
	expect(input?.placeholder).toBe("Original block default");
});

it("replaces a legacy colored card default without retaining its hidden tint", async () => {
	useGrammarDocumentStore.setState({
		designVariants: {
			...DEFAULT_DESIGN_VARIANTS,
			componentDefaults: { card: { style: "filled", color: "primary" } },
		},
	});
	renderWithProviders(<DesignSystemPanel />);
	fireEvent.click(screen.getByRole("button", { name: "Block Style Defaults" }));
	const input = document.querySelector<HTMLInputElement>('[id$="component-default-card-style"]');
	if (!input) throw new Error("Missing card style control");
	expect(input.value).toBe("Primary");
	fireEvent.click(input);
	fireEvent.click(await screen.findByRole("option", { name: "Shaded" }));
	expect(useGrammarDocumentStore.getState().designVariants.componentDefaults.card).toEqual({
		style: "shaded",
	});
});
it.each([
	[
		{ size: "small", width: "full" },
		{ size: "small", width: "full" },
	],
	[
		{ width: "small", layoutMode: "full" },
		{ size: "small", width: "full" },
	],
	[{ width: "full" }, { width: "full" }],
])(
	"preserves image dimensions when editing an exposed card default: %j",
	async (image, expected) => {
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				componentDefaults: { image, card: { layout: "single", layoutMode: "narrow" } },
			},
		});
		renderWithProviders(<DesignSystemPanel />);
		fireEvent.click(screen.getByRole("button", { name: "Block Style Defaults" }));
		const input = document.querySelector<HTMLInputElement>('[id$="component-default-card-layout"]');
		if (!input) throw new Error("Missing card layout control");
		expect(input.value).toBe("Slides");
		fireEvent.click(input);
		fireEvent.click(await screen.findByRole("option", { name: "Rows" }));
		expect(useGrammarDocumentStore.getState().designVariants.componentDefaults).toEqual({
			image: expected,
			card: { layout: "rows", width: "narrow" },
		});
	},
);

it("requests format and course defaults atomically without changing the module or theme", () => {
	useGrammarDocumentStore.getState().setParsedResult([], {
		design: {
			palette: "waves",
			glossaryPage: false,
			navOutline: false,
			deck: { initialPanel: "closed", autoAdvance: true },
		},
	} as never);
	const before = useGrammarDocumentStore.getState().designVariants;
	const onModuleDeckChange = vi.fn();
	renderWithProviders(
		<DesignSystemPanel
			onModuleDeckChange={onModuleDeckChange}
			onCourseDesignChange={vi.fn()}
			courseDeck={{ autoAdvance: false, followNarration: false }}
		/>,
	);
	fireEvent.click(screen.getByRole("radio", { name: "Guided slides" }));
	expect(onModuleDeckChange).toHaveBeenCalledOnce();
	expect(onModuleDeckChange).toHaveBeenCalledWith(
		true,
		expect.objectContaining({
			navArchetype: "slides",
			navTopBar: true,
			navCourseTitle: true,
			navLessonTitles: true,
			deck: expect.objectContaining({
				preset: "compact",
				initialPanel: "closed",
				autoAdvance: false,
				followNarration: false,
			}),
		}),
	);
	const defaults = onModuleDeckChange.mock.calls[0][1];
	expect(defaults.palette).toBeUndefined();
	expect(defaults.glossaryPage).toBeUndefined();
	expect(useGrammarDocumentStore.getState().designVariants).toBe(before);
	expect(useGrammarDocumentStore.getState()._designDirty).toBe(false);
});

it("retains guided identity after a change, serializes it, and resets only presentation", async () => {
	useGrammarDocumentStore.getState().setParsedResult([], {});
	renderWithProviders(
		<DesignSystemPanel
			moduleDeck
			courseDeck={{ initialPanel: "transcript", autoAdvance: false }}
			courseDesign={{ navTopBar: true }}
		/>,
	);
	fireEvent.click(screen.getByRole("switch", { name: "Include links to other modules" }));
	expect(screen.getByRole("status").textContent).toBe("Guided slides · Modified");
	expect((screen.getByRole("radio", { name: "Guided slides" }) as HTMLInputElement).checked).toBe(
		true,
	);
	const design = useGrammarDocumentStore.getState().designVariants;
	const body = "# Keep this heading {hideTitle}\n\n## Keep this heading\n\nAuthored content.\n";
	const saved = serializeFrontmatter({ design } as never, body);
	expect(
		resolveDeckDesign({
			initialPanel: "transcript",
			autoAdvance: false,
			...readBlockSource(saved).frontmatter.design?.deck,
		}),
	).toMatchObject({
		outlineDetail: "currentModule",
		autoAdvance: false,
	});
	expect(saved).toContain(body);
	fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));
	expect(screen.queryByRole("status")).toBeNull();
	expect(
		resolveDeckDesign({
			autoAdvance: false,
			...useGrammarDocumentStore.getState().designVariants.deck,
		}),
	).toMatchObject({
		preset: "compact",
		outlineDetail: "moduleLinks",
		initialPanel: "closed",
		autoAdvance: false,
	});
});

it("maps Pages sidebar choices to the existing closed drawer and preserves family identity", async () => {
	renderWithProviders(<DesignSystemPanel />);
	expect(screen.queryByRole("switch", { name: "Include links to other modules" })).toBeNull();
	fireEvent.click(screen.getByRole("switch", { name: "Show outline sidebar when module starts" }));
	expect(screen.queryByRole("combobox", { name: "Sidebar open when module starts" })).toBeNull();
	expect(useGrammarDocumentStore.getState().designVariants).toMatchObject({
		navArchetype: "custom",
		navArchetypeBase: "sidebar",
		navOutline: false,
		navHamburgerMenu: true,
	});
	expect(screen.getByRole("status").textContent).toBe("Pages · Modified");
	fireEvent.click(screen.getByRole("switch", { name: "Show page sections" }));
	const saved = readBlockSource(
		serializeFrontmatter({ design: useGrammarDocumentStore.getState().designVariants } as never),
	);
	expect(saved.frontmatter.design).toMatchObject({
		navFloatingToc: true,
		navOutline: false,
		navHamburgerMenu: true,
	});
	fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));
	expect(useGrammarDocumentStore.getState().designVariants).toMatchObject({
		navArchetype: "sidebar",
		navOutline: true,
		navHamburgerMenu: false,
		navFloatingToc: false,
	});
});

it("preserves sparse inherited header and narration choices when editing a lesson", () => {
	useGrammarDocumentStore
		.getState()
		.setParsedResult([], { design: { deck: { slideCounter: false } } } as never);
	renderWithProviders(
		<DesignSystemPanel
			moduleDeck
			courseDeck={{
				initialPanel: "transcript",
				followNarration: false,
				autoAdvance: false,
				outlineDetail: "currentModule",
			}}
			courseDesign={{ navTopBar: true, navCourseTitle: false, glossaryPage: false }}
		/>,
	);
	expect(
		(screen.getByRole("switch", { name: "Show course and module header" }) as HTMLInputElement)
			.checked,
	).toBe(false);
	fireEvent.click(screen.getByRole("switch", { name: "Include links to other modules" }));
	const design = useGrammarDocumentStore.getState().designVariants;
	expect(
		resolveDeckDesign({
			followNarration: false,
			autoAdvance: false,
			initialPanel: "transcript",
			...design.deck,
		}),
	).toMatchObject({
		slideCounter: false,
		followNarration: false,
		autoAdvance: false,
		initialPanel: "transcript",
		outlineDetail: "moduleLinks",
	});
	expect(design.navTopBar).toBeUndefined();
	expect(design.navCourseTitle).toBeUndefined();
	expect(design.glossaryPage).toBeUndefined();
	fireEvent.click(screen.getByRole("switch", { name: "Show course and module header" }));
	expect(useGrammarDocumentStore.getState().designVariants).toMatchObject({
		navTopBar: true,
		navCourseTitle: true,
		navLessonTitles: true,
	});
});

it("does not change legacy authored layouts when the panel opens", () => {
	useGrammarDocumentStore
		.getState()
		.setParsedResult([], { design: { navArchetype: "embedded" } } as never);
	const before = useGrammarDocumentStore.getState().designVariants;
	renderWithProviders(<DesignSystemPanel />);
	expect(screen.getByRole("status").textContent).toBe("Pages · Modified");
	expect(useGrammarDocumentStore.getState().designVariants).toBe(before);
	expect(useGrammarDocumentStore.getState()._designDirty).toBe(false);
});

it("inherits Pages sidebar choices without pinning them on a header edit", () => {
	useGrammarDocumentStore.getState().setParsedResult([], {});
	renderWithProviders(
		<DesignSystemPanel courseDesign={{ navOutline: false, navHamburgerMenu: true }} />,
	);
	expect(
		(
			screen.getByRole("switch", {
				name: "Show outline sidebar when module starts",
			}) as HTMLInputElement
		).checked,
	).toBe(false);
	fireEvent.click(screen.getByRole("switch", { name: "Show course and module header" }));
	const saved = readBlockSource(
		serializeFrontmatter({ design: useGrammarDocumentStore.getState().designVariants } as never),
	);
	expect(saved.frontmatter.design?.navOutline).toBeUndefined();
	expect(saved.frontmatter.design?.navHamburgerMenu).toBeUndefined();
});

it("separates the course format from options for this module", () => {
	renderWithProviders(<DesignSystemPanel />);
	const heading = screen.getByRole("heading", { name: "This module", level: 3 });
	const moduleSection = heading.parentElement;
	expect(screen.getByRole("radiogroup", { name: "Course format" })).toBeTruthy();
	expect(
		moduleSection?.contains(
			screen.getByRole("switch", { name: "Show outline sidebar when module starts" }),
		),
	).toBe(true);
	expect(
		moduleSection?.contains(screen.getByRole("switch", { name: "Show course and module header" })),
	).toBe(true);
	expect(moduleSection?.contains(screen.getByRole("radio", { name: "Pages" }))).toBe(false);
});

it("keeps inherited Guided defaults unmodified through unrelated design edits and serialization", () => {
	useGrammarDocumentStore.getState().setParsedResult([], { design: {} } as never);
	const courseDesign = {
		...getNavPreset("slides"),
		navArchetype: "slides",
		navTopBar: true,
		navCourseTitle: true,
		navLessonTitles: true,
	};
	renderWithProviders(
		<DesignSystemPanel
			moduleDeck
			courseDesign={courseDesign}
			courseDeck={{ preset: "transcript", initialPanel: "closed" }}
		/>,
	);
	expect(screen.queryByRole("status")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Theme", exact: true }));
	fireEvent.click(screen.getByRole("radio", { name: "Forest" }));
	fireEvent.click(screen.getByRole("button", { name: "Presentation", exact: true }));
	expect(screen.queryByRole("status")).toBeNull();
	fireEvent.click(screen.getByRole("switch", { name: "Show course and module header" }));
	expect(screen.getByRole("status").textContent).toBe("Guided slides · Modified");
	fireEvent.click(screen.getByRole("switch", { name: "Show course and module header" }));
	expect(screen.queryByRole("status")).toBeNull();
	const saved = readBlockSource(
		serializeFrontmatter({ design: useGrammarDocumentStore.getState().designVariants } as never),
	);
	expect(saved.frontmatter.design).toMatchObject({ palette: "forest", navTopBar: true });
	for (const key of [
		"navArchetype",
		"navPrevNext",
		"navProgressStyle",
		"navOutline",
		"navSwipeGestures",
	] as const) {
		expect(saved.frontmatter.design?.[key]).toBeUndefined();
	}
});
it("keeps an authored legacy module layout ahead of the course archetype", () => {
	useGrammarDocumentStore
		.getState()
		.setParsedResult([], { design: { navLayout: "none" } } as never);
	renderWithProviders(<DesignSystemPanel courseDesign={{ navArchetype: "sidebar" }} />);
	expect(
		(
			screen.getByRole("switch", {
				name: "Show outline sidebar when module starts",
			}) as HTMLInputElement
		).checked,
	).toBe(false);
	expect(screen.getByRole("status").textContent).toBe("Pages · Modified");
});

it("edits course defaults immediately and keeps module overrides separate", () => {
	useGrammarDocumentStore.getState().setParsedResult([], {
		design: {
			navOutline: true,
			navHamburgerMenu: false,
			palette: "waves",
		},
	} as never);
	const before = useGrammarDocumentStore.getState().designVariants;
	const onCourseChange = vi.fn();
	function CoursePanel() {
		const [design, setDesign] = useState<Record<string, unknown>>({
			navOutline: false,
			navHamburgerMenu: true,
		});
		return (
			<DesignSystemPanel
				courseDesign={design}
				onCourseDesignChange={(partial) => {
					onCourseChange(partial);
					setDesign((previous) => ({ ...previous, ...partial }));
				}}
			/>
		);
	}
	renderWithProviders(<CoursePanel />);
	const outline = () =>
		screen.getByRole("switch", {
			name: "Show outline sidebar when module starts",
		}) as HTMLInputElement;
	expect((screen.getByRole("radio", { name: "Course defaults" }) as HTMLInputElement).checked).toBe(
		true,
	);
	expect(outline().checked).toBe(false);
	fireEvent.click(outline());
	expect(outline().checked).toBe(true);
	expect(onCourseChange).toHaveBeenLastCalledWith(
		expect.objectContaining({ navOutline: true, navHamburgerMenu: false }),
	);
	expect(useGrammarDocumentStore.getState().designVariants).toBe(before);
	fireEvent.click(screen.getByRole("radio", { name: "This module" }));
	fireEvent.click(outline());
	expect(onCourseChange).toHaveBeenCalledOnce();
	const saved = readBlockSource(
		serializeFrontmatter({ design: useGrammarDocumentStore.getState().designVariants } as never),
	);
	expect(saved.frontmatter.design).toMatchObject({
		palette: "ink",
		navOutline: false,
		navHamburgerMenu: true,
	});
	fireEvent.click(screen.getByRole("radio", { name: "Course defaults" }));
	expect(outline().checked).toBe(true);
});

it("edits inherited course deck values without copying module overrides", () => {
	useGrammarDocumentStore.getState().setParsedResult([], {
		design: { deck: { autoAdvance: true, outlineDetail: "moduleLinks" } },
	} as never);
	const onCourseDesignChange = vi.fn();
	renderWithProviders(
		<DesignSystemPanel
			moduleDeck
			courseDeck={{ autoAdvance: false, followNarration: false, outlineDetail: "currentModule" }}
			onCourseDesignChange={onCourseDesignChange}
		/>,
	);
	const links = screen.getByRole("switch", {
		name: "Include links to other modules",
	}) as HTMLInputElement;
	expect(links.checked).toBe(false);
	fireEvent.click(links);
	expect(onCourseDesignChange).toHaveBeenCalledWith({
		deck: expect.objectContaining({
			autoAdvance: false,
			followNarration: false,
			outlineDetail: "moduleLinks",
		}),
	});
	expect(useGrammarDocumentStore.getState().designVariants.deck).toEqual({
		autoAdvance: true,
		outlineDetail: "moduleLinks",
	});
});
