import {
	createTypography,
	readLesson as readBlockSource,
	serializeFrontmatter,
} from "@praxity/grammar";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders as renderWithEditorProviders } from "../__tests__/test-utils";
import { DEFAULT_DESIGN_VARIANTS } from "../lib/themes/design-variant-defaults";
import { normalizeDesignVariants } from "../lib/themes/normalize-design-variants";
import { findCompliantAccent } from "../lib/themes/oklch";
import { THEME_PRESET_DEFAULTS } from "../lib/themes/theme-preset-defaults";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { DesignSystemPanel } from "./design-system-panel";
import { useGrammarDocumentStore } from "./grammar-document-store";

vi.mock("../lib/themes/load-font", () => ({ loadFont: vi.fn() }));
vi.mock("./theme-preview-thumbnail", () => ({ ThemePreviewThumbnail: () => null }));
vi.mock("./panel-chrome/panel-accordion", async () => ({
	PanelAccordion: (await import("./__tests__/lazy-panel-accordion")).LazyPanelAccordion,
}));

function renderWithProviders(ui: React.ReactElement) {
	// Browser suites cover theme CSS; handler tests need one provider without transitions.
	const result = renderWithEditorProviders(ui, { env: "test", withCssVariables: false });
	fireEvent.click(screen.getByRole("button", { name: "Theme", exact: true }));
	return result;
}

describe("DesignSystemPanel", () => {
	it("retries the original logo after changing to a different URL", async () => {
		useGrammarDocumentStore.getState().setParsedResult([], {
			design: { brand: { logoUrl: "assets/a.svg" } },
		} as never);
		renderWithProviders(<DesignSystemPanel />);
		fireEvent.error(screen.getByAltText("Course logo preview"));
		expect(screen.queryByAltText("Course logo preview")).toBeNull();
		await act(async () => {
			useGrammarDocumentStore
				.getState()
				.updateDesignVariants({ brand: { logoUrl: "assets/b.svg" } });
		});
		expect(screen.getByAltText("Course logo preview").getAttribute("src")).toBe("assets/b.svg");
		fireEvent.load(screen.getByAltText("Course logo preview"));
		await act(async () => {
			useGrammarDocumentStore
				.getState()
				.updateDesignVariants({ brand: { logoUrl: "assets/a.svg" } });
		});
		expect(screen.getByAltText("Course logo preview").getAttribute("src")).toBe("assets/a.svg");
		expect(screen.queryByText("Logo couldn't be loaded. Check the file or link.")).toBeNull();
	});
	it("keeps a failed logo unmounted on repeated renders of the same URL", async () => {
		useGrammarDocumentStore.getState().setParsedResult([], {
			design: { brand: { logoUrl: "assets/a.svg" } },
		} as never);
		renderWithProviders(<DesignSystemPanel />);
		fireEvent.error(screen.getByAltText("Course logo preview"));
		for (let render = 0; render < 3; render++) {
			await act(async () => {
				useGrammarDocumentStore.getState().updateDesignVariants({ accentHue: 180 + render });
			});
			expect(screen.queryByAltText("Course logo preview")).toBeNull();
			expect(screen.getByText("Logo couldn't be loaded. Check the file or link.")).toBeTruthy();
		}
	});
	it.each(["en", "fr"] as const)(
		"recovers from a failed logo without changing its URL in %s",
		async (locale) => {
			const messages = locale === "fr" ? fr : en;
			const upload = vi.fn().mockResolvedValue("assets/replacement.svg");
			useGrammarDocumentStore.getState().setParsedResult([], {
				design: { brand: { logoUrl: "assets/missing.svg", logoDarkUrl: "assets/other.svg" } },
			} as never);
			renderWithEditorProviders(
				<IntlProvider locale={locale} messages={messages}>
					<DesignSystemPanel onDesktopLogoUpload={upload} />
				</IntlProvider>,
				{ env: "test", withCssVariables: false },
			);
			fireEvent.click(
				screen.getByRole("button", { name: locale === "fr" ? "Thème" : "Theme", exact: true }),
			);
			fireEvent.error(screen.getByAltText(messages.editor.designSystem.logoPreviewAlt));
			expect(screen.queryByAltText(messages.editor.designSystem.logoPreviewAlt)).toBeNull();
			expect(
				screen.getByText(
					locale === "fr"
						? "Le logo n'a pas pu être chargé. Vérifiez le fichier ou le lien."
						: "Logo couldn't be loaded. Check the file or link.",
				),
			).toBeTruthy();
			expect(useGrammarDocumentStore.getState().designVariants.brand?.logoUrl).toBe(
				"assets/missing.svg",
			);
			fireEvent.click(
				screen.getByRole("button", { name: messages.editor.designSystem.replaceLogo, exact: true }),
			);
			await waitFor(() =>
				expect(useGrammarDocumentStore.getState().designVariants.brand?.logoUrl).toBe(
					"assets/replacement.svg",
				),
			);
			expect(
				screen.getByAltText(messages.editor.designSystem.logoPreviewAlt).getAttribute("src"),
			).toBe("assets/replacement.svg");
			expect(screen.queryByText(/couldn't be loaded|n'a pas pu être chargé/)).toBeNull();
			fireEvent.click(
				screen.getByRole("button", { name: messages.editor.designSystem.removeLogo, exact: true }),
			);
			expect(useGrammarDocumentStore.getState().designVariants.brand).toMatchObject({
				logoDarkUrl: "assets/other.svg",
			});
			expect(useGrammarDocumentStore.getState().designVariants.brand?.logoUrl).toBeUndefined();
		},
	);
	it("uses French grammar labels for block defaults and keeps the stored value", () => {
		renderWithEditorProviders(
			<IntlProvider locale="fr" messages={fr}>
				<DesignSystemPanel />
			</IntlProvider>,
			{ env: "test", withCssVariables: false },
		);
		fireEvent.click(screen.getByRole("button", { name: "Styles de bloc par défaut" }));
		const card = screen.getByRole("combobox", { name: "Cartes · Mise en page" });
		fireEvent.click(card);
		fireEvent.click(screen.getByRole("option", { name: "Diapositives" }));
		expect(useGrammarDocumentStore.getState().designVariants.componentDefaults.card).toMatchObject({
			layout: "slides",
		});
		for (const label of [
			"Accordéon · Style",
			"Onglets · Orientation",
			"Séquence · Alignement",
			"Signature · Mode",
		])
			expect(screen.getByRole("combobox", { name: label })).toBeTruthy();
	});
	it("shows recovery beside invalid numeric controls and clears it when the field changes", () => {
		useGrammarDocumentStore.getState().setParsedResult([], {
			design: {
				headingSize: "large",
				lineHeight: null,
				accentHue: 1000000,
			},
		} as never);
		renderWithProviders(<DesignSystemPanel />);
		const heading = screen.getByRole("combobox", { name: "Heading size" });
		const description = document.getElementById(heading.getAttribute("aria-describedby") ?? "");
		expect(description?.querySelector("p p")).toBeNull();
		expect(
			document.getElementById(heading.getAttribute("aria-describedby") ?? "")?.textContent,
		).toBe("Saved value 'large' isn't a number. Using 2.375rem until you change it.");
		const hue = screen.getByRole("slider", { name: /hue/i });
		expect(hue.getAttribute("aria-valuenow")).toBe("360");
		expect(hue.getAttribute("aria-valuemax")).toBe("360");
		expect(screen.getByText(/Saved value '1000000' is outside/)).toBeTruthy();
		fireEvent.keyDown(hue, { key: "Home" });
		expect(screen.queryByText(/Saved value '1000000'/)).toBeNull();
	});
	it("shows the precise recovery value and saves a nearby ordinary choice", async () => {
		useGrammarDocumentStore
			.getState()
			.setParsedResult([], { design: { headingSize: "large", lineHeight: null } } as never);
		renderWithProviders(<DesignSystemPanel />);
		const heading = screen.getByRole("combobox", { name: "Heading size" });
		expect((heading as HTMLInputElement).value).toBe("2.375rem");
		expect((screen.getByRole("combobox", { name: "Line height" }) as HTMLInputElement).value).toBe(
			"1.55",
		);
		fireEvent.click(heading);
		fireEvent.click(await screen.findByRole("option", { name: "2.4rem" }));
		expect((heading as HTMLInputElement).value).toBe("2.4rem");
		expect(screen.queryByText(/Saved value 'large'/)).toBeNull();
	});
	beforeEach(() => {
		HTMLElement.prototype.scrollIntoView = vi.fn();
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callback(0));
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		window.matchMedia = vi.fn().mockReturnValue({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		useGrammarDocumentStore.setState({
			designVariants: DEFAULT_DESIGN_VARIANTS,
			designNumberDiagnostics: [],
			frontmatter: {},
			_designDirty: false,
		});
	});

	it("offers five course palettes", () => {
		renderWithProviders(<DesignSystemPanel />);
		const themeGroup = within(screen.getByRole("radiogroup", { name: "Preset" }));
		expect(
			themeGroup.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label")),
		).toEqual(["Ink", "Forest", "Plum", "Clay", "Clear"]);
		for (const description of [
			"White paper and deep navy",
			"White paper and deep green",
			"White paper and deep plum",
			"Warm paper and deep brick",
			"Navy with Atkinson Hyperlegible Next",
		])
			expect(screen.getByText(description)).toBeTruthy();
	});

	it.each([
		["{ArrowRight}", "plum", "Plum"],
		["{End}", "clear", "Clear"],
		["{Home}", "ink", "Ink"],
	])("selects a theme with %s", async (key, palette, label) => {
		const user = userEvent.setup();
		renderWithProviders(<DesignSystemPanel />);
		screen.getByRole("radio", { name: "Forest" }).focus();
		await user.keyboard(key);
		expect(useGrammarDocumentStore.getState().designVariants.palette).toBe(palette);
		expect(document.activeElement).toBe(screen.getByRole("radio", { name: label }));
	});

	it("falls back to Ink for an unknown prototype-named persisted palette", () => {
		useGrammarDocumentStore.setState({
			designVariants: { ...DEFAULT_DESIGN_VARIANTS, palette: "constructor" },
		});
		renderWithProviders(<DesignSystemPanel />);

		const themeGroup = within(screen.getByRole("radiogroup", { name: "Preset" }));
		expect(themeGroup.getAllByRole("radio")).toHaveLength(5);
		expect(themeGroup.getByRole("radio", { name: "Ink" }).getAttribute("aria-checked")).toBe(
			"true",
		);
	});

	it.each([
		{ preset: "blueprint", label: "Forest", current: "forest" },
		{ preset: "marquee", label: "Plum", current: "plum" },
	] as const)(
		"keeps an active legacy $preset theme selected and resettable",
		async ({ preset, label, current }) => {
			const user = userEvent.setup();
			useGrammarDocumentStore.setState({
				designVariants: {
					...DEFAULT_DESIGN_VARIANTS,
					...THEME_PRESET_DEFAULTS[preset],
					palette: preset,
					headingSize: (THEME_PRESET_DEFAULTS[preset].headingSize ?? 2) + 0.2,
				},
			});
			renderWithProviders(<DesignSystemPanel />);

			expect(
				within(screen.getByRole("radiogroup", { name: "Preset" })).getAllByRole("radio"),
			).toHaveLength(5);
			expect(screen.getByRole("radio", { name: label }).getAttribute("aria-checked")).toBe("true");
			expect(screen.getByRole("radio", { name: "Ink" }).getAttribute("aria-checked")).toBe("false");

			await user.click(screen.getByRole("button", { name: "Reset to preset" }));
			expect(useGrammarDocumentStore.getState().designVariants.palette).toBe(current);
			expect(useGrammarDocumentStore.getState().designVariants.headingSize).toBe(
				THEME_PRESET_DEFAULTS[preset].headingSize,
			);
			expect(document.activeElement).toBe(screen.getByRole("radio", { name: label }));
		},
	);

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("keeps the retained sections and points to frontmatter-only tokens", async () => {
		renderWithProviders(<DesignSystemPanel />);

		for (const heading of ["Preset", "Colors", "Typography", "Brand logo"]) {
			expect(screen.getByRole("heading", { level: 3, name: heading })).toBeTruthy();
		}
		expect(screen.getAllByText("Light mode")).toHaveLength(1);
		expect(screen.getAllByText("Dark mode")).toHaveLength(1);
		expect(screen.queryByText("Image effects")).toBeNull();
		expect(screen.queryByText("Texture & Highlights")).toBeNull();

		expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
		expect(screen.queryByRole("heading", { level: 3, name: "Motion" })).toBeNull();
		for (const heading of ["Spacing & Density", "Card Style"])
			expect(screen.queryByRole("heading", { level: 3, name: heading })).toBeNull();
		expect(screen.queryByText("Section gap")).toBeNull();
		expect(screen.queryByText("Sections & Layout")).toBeNull();
		expect(screen.queryByText("Hover effect")).toBeNull();

		const pointer = screen.getByRole("link", {
			name: "More design tokens (textures, image effects) are available in frontmatter",
		});
		expect(pointer.getAttribute("href")).toContain("reference/frontmatter-design.md#image-effects");
	});

	it("hides scroll-reveal controls even for a saved entrance effect", () => {
		useGrammarDocumentStore.getState().setParsedResult([], {
			design: { motionEntrance: "slide", motionStagger: "sequential" },
		} as never);
		renderWithProviders(<DesignSystemPanel />);
		expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
		expect(screen.queryByRole("combobox", { name: "Appear animation" })).toBeNull();
		expect(screen.queryByRole("combobox", { name: "Reveal items one at a time" })).toBeNull();
	});

	it.each([
		["ink", "Ink"],
		["forest", "Forest"],
		["plum", "Plum"],
		["clay", "Clay"],
		["clear", "Clear"],
	] as const)("replaces all visual customizations when selecting %s", (preset, label) => {
		const brand = { logoUrl: "assets/logo.svg", logoDarkUrl: "assets/dark.svg" };
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				brand,
				navArchetype: "slides",
				typography: createTypography("Lora", "Lora"),
				headingSize: 3.2,
				lineHeight: 2,
				colorBackgroundLight: "#ffffff",
				colorBackgroundDark: "#000000",
				colorAccent: "#123456",
				colorSuccessOnLight: "#123456",
				colorSuccessOnDark: "#abcdef",
				colorErrorOnLight: "#123456",
				colorErrorOnDark: "#abcdef",
				colorWarningOnLight: "#123456",
				colorWarningOnDark: "#abcdef",
				density: "compact",
				blockSpacing: "compact",
				sectionGap: 80,
				contentMaxWidth: 1200,
				borderRadius: 24,
				shadowIntensity: "elevated",
				motionEntrance: "slide",
				motionStagger: "sequential",
				slideTransition: "zoom",
				componentDefaults: { button: { style: "outline" } },
			},
		});
		renderWithProviders(<DesignSystemPanel />);
		fireEvent.click(screen.getByRole("radio", { name: label, exact: true }));
		const design = useGrammarDocumentStore.getState().designVariants;
		expect(design).toMatchObject({
			...THEME_PRESET_DEFAULTS[preset],
			palette: preset,
			brand,
			navArchetype: "slides",
			motionEntrance: "none",
			motionStagger: "none",
			slideTransition: "none",
		});
		expect(design.componentDefaults).toEqual({});
		expect(design.typography).toEqual(THEME_PRESET_DEFAULTS[preset].typography);
		const persisted = readBlockSource(serializeFrontmatter({ design }, "# Example\n")).frontmatter
			?.design;
		expect(persisted).toMatchObject({
			typography: THEME_PRESET_DEFAULTS[preset].typography,
			brand,
			motionEntrance: "none",
			motionStagger: "none",
			slideTransition: "none",
		});
		for (const key of [
			"colorSuccessOnLight",
			"colorSuccessOnDark",
			"colorErrorOnLight",
			"colorErrorOnDark",
			"colorWarningOnLight",
			"colorWarningOnDark",
		])
			expect(persisted).not.toHaveProperty(key);
		expect(screen.queryByRole("button", { name: "Reset to preset" })).toBeNull();
	});

	it("resets custom settings to the selected theme while keeping branding and navigation", async () => {
		const user = userEvent.setup();
		const brand = { logoUrl: "/assets/logo.svg" };
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				palette: "clay",
				...THEME_PRESET_DEFAULTS.clay,
				brand,
				navArchetype: "sidebar",
			},
		});
		renderWithProviders(<DesignSystemPanel />);
		expect(screen.queryByRole("button", { name: "Reset to preset" })).toBeNull();
		await user.click(screen.getByRole("combobox", { name: "Font pairing" }));
		await user.keyboard("{ArrowDown}{Enter}");
		const reset = screen.getByRole("button", { name: "Reset to preset" });
		expect(reset.parentElement?.querySelector("h3")?.textContent).toBe("Preset");
		await user.click(reset);
		expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Clay" }));
		expect(useGrammarDocumentStore.getState().designVariants).toMatchObject({
			...THEME_PRESET_DEFAULTS.clay,
			palette: "clay",
			brand,
			navArchetype: "sidebar",
		});
		expect(screen.queryByRole("button", { name: "Reset to preset" })).toBeNull();
	});

	it("keeps inherited navigation absent and authored deck settings when selecting a palette", () => {
		const brand = { logoUrl: "assets/logo.svg" };
		const design = normalizeDesignVariants({
			palette: "ink",
			brand,
			deck: { autoAdvance: false, initialPanel: "transcript" },
		});
		useGrammarDocumentStore.setState({ designVariants: design });
		renderWithProviders(<DesignSystemPanel />);
		fireEvent.click(screen.getByRole("radio", { name: "Forest", exact: true }));
		const saved = useGrammarDocumentStore.getState().designVariants;
		expect(saved.palette).toBe("forest");
		expect(saved.brand).toEqual(design.brand);
		expect(saved.deck).toEqual(design.deck);
		for (const key of ["navArchetype", "navLayout", "navOutline", "navTopBar", "navProgressStyle"])
			expect(saved).not.toHaveProperty(key);
	});

	it("localizes the frontmatter pointer in English and French", () => {
		expect(en.editor.designSystem.moreDesignTokens).toBe(
			"More design tokens (textures, image effects) are available in frontmatter",
		);
		expect(fr.editor.designSystem.moreDesignTokens).toBe(
			"D'autres jetons de design (textures, effets d'image) sont disponibles dans le frontmatter",
		);
	});

	it("uses one Show logo on dropdown for logo placement", async () => {
		const user = userEvent.setup();
		renderWithProviders(<DesignSystemPanel />);

		const showOn = screen.getByRole("combobox", { name: "Show logo on" });
		expect(showOn.getAttribute("value")).toBe("Header bar");
		expect(screen.queryByText("Placement")).toBeNull();

		await user.click(showOn);
		expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
			"Sidebar",
			"Header bar",
			"Hide",
		]);
		await user.click(screen.getByRole("option", { name: "Sidebar" }));

		expect(useGrammarDocumentStore.getState().designVariants.brand).toEqual({
			logoPlacement: "sidebar",
		});
	});

	it.each([
		["Course logo preview", "logoUrl"],
		["Dark logo preview", "logoDarkUrl"],
	] as const)("resolves %s without changing the other saved path", async (previewAlt, field) => {
		const user = userEvent.setup();
		const brand = { logoUrl: "assets/light.svg", logoDarkUrl: "assets/dark.svg" };
		useGrammarDocumentStore.setState({
			designVariants: { ...DEFAULT_DESIGN_VARIANTS, brand },
		});
		const upload = vi.fn().mockResolvedValue("assets/replacement.svg");
		renderWithProviders(
			<DesignSystemPanel
				transformImageUrl={(url) => `praxity-asset://${url}`}
				onDesktopLogoUpload={upload}
			/>,
		);

		expect(screen.getByAltText("Course logo preview").getAttribute("src")).toBe(
			"praxity-asset://assets/light.svg",
		);
		expect(screen.getByAltText("Dark logo preview").getAttribute("src")).toBe(
			"praxity-asset://assets/dark.svg",
		);
		expect(useGrammarDocumentStore.getState().designVariants.brand).toEqual(brand);
		await user.click(screen.getByAltText(previewAlt));
		expect(await screen.findByAltText(previewAlt)).toHaveProperty(
			"src",
			"praxity-asset://assets/replacement.svg",
		);
		expect(useGrammarDocumentStore.getState().designVariants.brand).toEqual({
			...brand,
			[field]: "assets/replacement.svg",
		});
	});

	it.each([
		["Replace logo", "Course logo preview", null, null],
		["Replace logo", "Course logo preview", new Error("Logo picker failed"), "Logo picker failed"],
		["Replace dark logo", "Dark logo preview", null, null],
		[
			"Replace dark logo",
			"Dark logo preview",
			new Error("Logo picker failed"),
			"Logo picker failed",
		],
	])("keeps %s and %s after picker outcome %s", async (label, previewAlt, outcome, error) => {
		const user = userEvent.setup();
		const brand = { logoUrl: "assets/light.svg", logoDarkUrl: "assets/dark.svg" };
		useGrammarDocumentStore.setState({
			designVariants: { ...DEFAULT_DESIGN_VARIANTS, brand },
		});
		const upload = vi
			.fn()
			.mockImplementation(() =>
				outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
			);
		renderWithProviders(<DesignSystemPanel onDesktopLogoUpload={upload} />);

		const picker = screen.getByRole("button", { name: label }) as HTMLButtonElement;
		await user.click(picker);
		await waitFor(() => {
			expect(picker.disabled).toBe(false);
			expect(screen.queryByText("Logo picker failed")?.textContent ?? null).toBe(error);
		});
		expect(screen.getByAltText(previewAlt).getAttribute("src")).toBe(
			previewAlt === "Course logo preview" ? "assets/light.svg" : "assets/dark.svg",
		);
		expect(useGrammarDocumentStore.getState().designVariants.brand).toEqual(brand);
	});

	it("disables logo upload when the host has no picker", () => {
		renderWithProviders(<DesignSystemPanel />);
		expect(screen.getByRole("button", { name: "Upload logo" })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Upload dark logo" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it.each([
		["Replace logo", "Clear logo", "Replace dark logo"],
		["Replace dark logo", "Clear dark logo", "Replace logo"],
	])("keeps %s busy until the host picker settles", async (label, removeLabel, otherLabel) => {
		const user = userEvent.setup();
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				brand: { logoUrl: "assets/light.svg", logoDarkUrl: "assets/dark.svg" },
			},
		});
		let finishUpload!: (path: string | null) => void;
		const upload = () =>
			new Promise<string | null>((resolve) => {
				finishUpload = resolve;
			});
		renderWithProviders(<DesignSystemPanel onDesktopLogoUpload={upload} />);
		const picker = screen.getByRole("button", { name: label });
		await user.click(picker);
		expect(picker.getAttribute("aria-busy")).toBe("true");
		expect(picker).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: removeLabel })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: otherLabel })).toHaveProperty("disabled", false);
		finishUpload(null);
		await waitFor(() => expect(picker).toHaveProperty("disabled", false));
		expect(picker.hasAttribute("aria-busy")).toBe(false);
	});

	it("keeps logo URLs unchanged without a platform transform", () => {
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				brand: { logoUrl: "assets/light.svg", logoDarkUrl: "data:image/svg+xml,test" },
			},
		});
		renderWithProviders(<DesignSystemPanel />);
		expect(screen.getByAltText("Course logo preview").getAttribute("src")).toBe("assets/light.svg");
		expect(screen.getByAltText("Dark logo preview").getAttribute("src")).toBe(
			"data:image/svg+xml,test",
		);
	});

	it.each([
		["Sans", "sans", "Source Sans 3"],
		["Book", "book", "Source Serif 4"],
		["Clear", "clear", "Atkinson Hyperlegible Next"],
	] as const)("persists the %s pairing through its control", async (label, pairing, heading) => {
		const user = userEvent.setup();
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				...THEME_PRESET_DEFAULTS.darkroom,
				palette: "darkroom",
			},
		});
		renderWithProviders(<DesignSystemPanel />);
		await user.click(screen.getByRole("combobox", { name: "Font pairing" }));
		expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
			"Sans",
			"Book",
			"Clear",
		]);
		await user.click(screen.getByRole("option", { name: label, exact: true }));
		const headings = useGrammarDocumentStore.getState().designVariants.typography.headings;
		expect(headings.fontFamily[0]).toBe(heading);
		for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
			expect(headings[level]?.fontFamily).toBeUndefined();
		}
		const persisted = readBlockSource(
			serializeFrontmatter(
				{ design: useGrammarDocumentStore.getState().designVariants },
				"# Example\n",
			),
		).frontmatter?.design;
		expect(persisted).toMatchObject({ typography: { pairing } });
		await user.click(screen.getByRole("button", { name: "Reset to preset" }));
		expect(useGrammarDocumentStore.getState().designVariants.typography.headings).toEqual(
			THEME_PRESET_DEFAULTS.plum.typography.headings,
		);
	});

	it("persists real accent colors from both the color field and hue slider", async () => {
		const user = userEvent.setup();
		renderWithProviders(<DesignSystemPanel />);
		const input = screen.getByRole("textbox", { name: /accent color hex color value/i });
		await user.clear(input);
		await user.type(input, "#7e22ce");
		await user.tab();
		let design = useGrammarDocumentStore.getState().designVariants;
		expect(design.colorAccent).not.toBe(DEFAULT_DESIGN_VARIANTS.colorAccent);
		expect(design.colorButtonBackground).toBe(design.colorAccent);
		const slider = screen.getByRole("slider", { name: /hue/i });
		fireEvent.keyDown(slider, { key: "Home" });
		design = useGrammarDocumentStore.getState().designVariants;
		expect(design.accentHue).toBe(0);
		const expected = findCompliantAccent(0, design.colorBackgroundLight ?? "#fff");
		const persisted = readBlockSource(serializeFrontmatter({ design }, "# Example\n")).frontmatter
			?.design;
		expect(persisted).toMatchObject({
			colorAccent: expected,
			colorButtonBackground: expected,
			accentHue: 0,
		});
	});

	it.each([
		["Light background", "colorBackgroundLight", "#fff8ed"],
		["Dark background", "colorBackgroundDark", "#101827"],
		["Success · Light", "colorSuccessOnLight", "#14532d"],
		["Success · Dark", "colorSuccessOnDark", "#86efac"],
		["Error · Light", "colorErrorOnLight", "#9f1239"],
		["Error · Dark", "colorErrorOnDark", "#fda4af"],
		["Warning · Light", "colorWarningOnLight", "#78350f"],
		["Warning · Dark", "colorWarningOnDark", "#fde68a"],
	])("persists the %s color", (label, key, value) => {
		renderWithProviders(<DesignSystemPanel />);
		const input = screen.getByRole("textbox", { name: `${label} hex color value` });
		fireEvent.change(input, { target: { value } });
		fireEvent.blur(input);
		const persisted = readBlockSource(
			serializeFrontmatter(
				{ design: useGrammarDocumentStore.getState().designVariants },
				"# Example\n",
			),
		).frontmatter?.design;
		expect(persisted).toMatchObject({ [key]: value });
	});

	it.each([
		["Dark", "dark"],
		["Auto", "auto"],
		["Light", "light"],
	])("persists %s appearance", async (label, mode) => {
		useGrammarDocumentStore.setState({
			designVariants: { ...DEFAULT_DESIGN_VARIANTS, colorMode: mode === "dark" ? "light" : "dark" },
		});
		const user = userEvent.setup();
		renderWithProviders(<DesignSystemPanel />);
		await user.click(screen.getByRole("radio", { name: label, exact: true }));
		const persisted = readBlockSource(
			serializeFrontmatter(
				{ design: useGrammarDocumentStore.getState().designVariants },
				"# Example\n",
			),
		).frontmatter?.design;
		expect(persisted).toMatchObject({ colorMode: mode });
	});

	it.each([
		["Heading size", /^3.2\s*rem$/, { headingSize: 3.2 }],
		["Line height", /^2.0$/, { lineHeight: 2 }],
	] as const)("persists %s through its real control", async (label, option, expected) => {
		const user = userEvent.setup();
		renderWithProviders(<DesignSystemPanel />);
		await user.click(screen.getByRole("combobox", { name: label }));
		await user.click(await screen.findByRole("option", { name: option }));
		const persisted = readBlockSource(
			serializeFrontmatter(
				{ design: useGrammarDocumentStore.getState().designVariants },
				"# Example\n",
			),
		).frontmatter?.design;
		expect(persisted).toMatchObject(expected);
	});

	it("keeps compact logo actions accessible and clears only its slot", async () => {
		const user = userEvent.setup();
		useGrammarDocumentStore.setState({
			designVariants: {
				...DEFAULT_DESIGN_VARIANTS,
				brand: { logoUrl: "assets/light.svg", logoDarkUrl: "assets/dark.svg" },
			},
		});
		renderWithProviders(<DesignSystemPanel />);
		expect(screen.getAllByRole("button", { name: /^Clear (dark )?logo$/ })).toHaveLength(2);
		expect(screen.getAllByRole("button", { name: /^Replace (dark )?logo$/ })).toHaveLength(2);
		await user.click(screen.getByRole("button", { name: "Clear logo" }));
		expect(useGrammarDocumentStore.getState().designVariants.brand).toEqual({
			logoUrl: undefined,
			logoDarkUrl: "assets/dark.svg",
		});
	});

	it("selects the Book pairing with the keyboard", async () => {
		const user = userEvent.setup();
		renderWithProviders(<DesignSystemPanel />);
		await user.click(screen.getByRole("combobox", { name: "Font pairing" }));
		await user.keyboard("{ArrowDown}{Enter}");
		expect(useGrammarDocumentStore.getState().designVariants.typography.pairing).toBe("book");
	});
});
