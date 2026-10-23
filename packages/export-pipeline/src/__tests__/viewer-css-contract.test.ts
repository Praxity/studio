import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { type Rule, type StyleSheet, type SupportsCondition, transform } from "lightningcss";
import { beforeAll, describe, expect, it } from "vitest";
import { viewerStylesheetBuilds } from "../bundle-viewer";
import { desktopExportInputs } from "../export-assets";
import { SLIDE_ARTWORK_CSS } from "../slide-artwork-css";

function mediaContents(css: string, query: string): string {
	const blocks: string[] = [];
	let cursor = 0;
	while (cursor < css.length) {
		const start = css.indexOf("@media ", cursor);
		if (start === -1) break;
		const openingBrace = css.indexOf("{", start);
		if (openingBrace === -1) break;
		cursor = openingBrace + 1;
		let depth = 0;
		for (let index = openingBrace; index < css.length; index += 1) {
			if (css[index] === "{") depth += 1;
			if (css[index] === "}") depth -= 1;
			if (depth === 0) {
				if (
					css
						.slice(start + 7, openingBrace)
						.split(",")
						.some((part) => part.trim() === query)
				)
					blocks.push(css.slice(openingBrace + 1, index));
				cursor = index + 1;
				break;
			}
		}
	}
	return blocks.join("\n");
}

function paletteGate(condition: SupportsCondition): boolean {
	return (
		(condition.type === "declaration" &&
			condition.propertyId.property === "forced-color-adjust" &&
			condition.value === "auto") ||
		(condition.type === "and" && condition.value.some(paletteGate))
	);
}

function ungatedForcedColors(css: string, filename = "probe.css"): string[] {
	let sheet: StyleSheet | undefined;
	transform({
		filename,
		code: Buffer.from(css),
		errorRecovery: false,
		// Capture only: returning the AST round-trips unsupported at-rule shapes.
		// Omit targets so nesting and grouping-rule children remain intact.
		visitor: {
			StyleSheet(value) {
				sheet = value;
			},
		},
	});
	if (!sheet) throw new Error(`No CSS syntax tree for ${filename}`);
	const violations: string[] = [];
	function visit(rules: Rule[], gated = false) {
		for (const rule of rules) {
			if (!("value" in rule) || !rule.value) continue;
			const {
				rules: children,
				declarations: _declarations,
				...prelude
			} = rule.value as {
				rules?: Rule[];
				declarations?: unknown;
			};
			// Deliberately conservative: even inactive-only feature references need a gate.
			if (!gated && /forced-colors/i.test(JSON.stringify(prelude))) violations.push(rule.type);
			visit(
				children ?? [],
				gated || (rule.type === "supports" && paletteGate(rule.value.condition)),
			);
		}
	}
	visit(sheet.rules);
	return violations;
}

describe("viewer stylesheet ownership", () => {
	let globalCss: string;
	let viewerCss: string;
	let blocksCss: string;
	let sharedProvider: string;

	beforeAll(async () => {
		[globalCss, viewerCss, blocksCss, sharedProvider] = await Promise.all([
			readFile(path.resolve(import.meta.dirname, "../../template/src/styles/global.css"), "utf-8"),
			readFile(
				path.resolve(import.meta.dirname, "../../../shared-blocks/src/viewer/viewer-shell.css"),
				"utf-8",
			),
			readFile(
				path.resolve(import.meta.dirname, "../../../shared-blocks/src/blocks/shared-blocks.css"),
				"utf-8",
			),
			readFile(
				path.resolve(
					import.meta.dirname,
					"../../../shared-blocks/src/viewer/MantineIslandProvider.tsx",
				),
				"utf-8",
			),
		]);
	});

	it("gates every published forced-colors rule on palette support", async () => {
		const sources = new Set(
			(await desktopExportInputs())
				.map((input) => input.source)
				.filter((source) => source.endsWith(".css")),
		);
		const builds = [
			...Object.values(viewerStylesheetBuilds("out")),
			{
				entryPoints: Object.fromEntries(
					[...sources].map((source, index) => [`copied-${index}`, source]),
				),
				bundle: true,
				outdir: "out",
				loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".svg": "file" } as const,
			},
		];
		for (const options of builds) {
			const result = await build({ ...options, write: false, minify: false, metafile: true });
			for (const source of Object.keys(result.metafile.inputs))
				if (source.endsWith(".css")) sources.add(path.resolve(source));
		}
		// These copied/independent assets must remain in the owned build inventory.
		expect([...sources].some((source) => source.endsWith("review-comments.css"))).toBe(true);
		expect(
			[...sources].some((source) =>
				source.replaceAll("\\", "/").endsWith("retrieval-sheet/style.css"),
			),
		).toBe(true);
		for (const source of sources) {
			const css = await readFile(source, "utf-8");
			expect(() => ungatedForcedColors(css, source), source).not.toThrow();
			expect(ungatedForcedColors(css, source), source).toEqual([]);
		}
		expect(
			() => ungatedForcedColors(SLIDE_ARTWORK_CSS, "slide-artwork-css.ts"),
			"slide-artwork-css.ts",
		).not.toThrow();
		expect(
			ungatedForcedColors(SLIDE_ARTWORK_CSS, "slide-artwork-css.ts"),
			"slide-artwork-css.ts",
		).toEqual([]);
	});

	it("rejects an unwrapped forced-colors block beside a supported block", () => {
		const forced = "@media (forced-colors: active) { a { color: Highlight; } }";
		expect(ungatedForcedColors(`@supports (forced-color-adjust: auto) { ${forced} }`)).toEqual([]);
		expect(
			ungatedForcedColors(`@supports (forced-color-adjust: auto) { ${forced} } ${forced}`),
		).toHaveLength(1);
		expect(
			ungatedForcedColors(`@supports not (forced-color-adjust: auto) { ${forced} }`),
		).toHaveLength(1);
	});

	it.each([
		"@media (forced-colors)",
		"@media not (forced-colors: none)",
		"@media not screen and (forced-colors: none)",
		"@media ((forced-colors: active) and (min-width: 1px))",
		"@container style(--mode: forced-colors)",
		"@supports (forced-colors: active)",
		"@media (FORCED-COLORS/**/: active)",
		"@media (forced-\\63 olors: active)",
	])("rejects an ungated condition: %s", (condition) => {
		expect(ungatedForcedColors(`${condition} { a { color: Highlight; } }`)).toHaveLength(1);
	});

	it.each([
		"@media screen and (forced-colors: active)",
		"@media only screen and (forced-colors: active)",
		"@media not print and (forced-colors: none)",
		"@media print, (forced-colors: active)",
		"@media (min-width: 1px) or (forced-colors)",
		"@media (not (forced-colors: none))",
		"@media not ((forced-colors: none))",
		"@media (forced-colors: active)and (min-width: 1px)",
		"@media (forced-colors: ACTIVE)",
		String.raw`@media (forced-colors: \61 ctive)`,
		String.raw`@media (forced\-colors: active)`,
		String.raw`@media (\000066orced-colors)`,
		"@media (forced-colors:/**/active)",
		"@media (prefers-contrast: more), (forced-colors: active)",
	])("rejects the reviewed media spelling: %s", (condition) => {
		expect(ungatedForcedColors(`${condition} { a { color: Highlight; } }`)).toHaveLength(1);
	});

	it.each([
		"@scope (.a) { @media (forced-colors) { a { color: Highlight; } } }",
		"@starting-style { @media (forced-colors) { a { color: Highlight; } } }",
		'@import "x.css" screen and (forced-colors: active);',
		"@custom-media --fc (forced-colors: active); @media (--fc) { a { color: Highlight; } }",
		"@layer a, b; @media (forced-colors) { a { color: Highlight; } }",
		'@charset "utf-8"; @media (forced-colors) { a { color: Highlight; } }',
		"@supports (forced-color-adjust: none) { @media (forced-colors) { a { color: Highlight; } } }",
		'@supports (forced-color-adjust: auto) { .x { content: "}"; } } @media (forced-colors) { a { color: Highlight; } }',
		'@supports (forced-color-adjust: auto) { a[title="{"] { color: red; } } @media (forced-colors) { a { color: Highlight; } }',
		String.raw`@supports (forced-color-adjust: auto) { .a\{ { color: red; } } @media (forced-colors) { a { color: Highlight; } }`,
	])("rejects a reviewed rule or gate escape: %s", (css) => {
		expect(ungatedForcedColors(css)).toHaveLength(1);
	});

	it("preserves a valid gated mixed contrast list", () => {
		expect(
			ungatedForcedColors(
				"@supports (forced-color-adjust: auto) { @media (prefers-contrast: more), (forced-colors: active) { a { color: Highlight; } } }",
			),
		).toEqual([]);
	});

	it.each([
		"@media (forced-colors: none)",
		"@media not (forced-colors)",
		"@media ((forced-colors) and (forced-colors: none))",
	])("conservatively gates inactive-only feature references: %s", (condition) => {
		expect(ungatedForcedColors(`${condition} { a { color: red; } }`)).toHaveLength(1);
	});

	it.each(["@container (width > 1px)", "@supports (display: grid)", "@layer repairs", ".nested"])(
		"finds a forced condition nested inside %s",
		(outer) => {
			const css = `${outer} { @media not (forced-colors: none) { a { color: Highlight; } } }`;
			expect(ungatedForcedColors(css)).toHaveLength(1);
			expect(ungatedForcedColors(`@supports (forced-color-adjust: auto) { ${css} }`)).toEqual([]);
		},
	);

	it("requires support even when an ordinary OR arm matches", () => {
		const css = "@media (forced-colors: none), (min-width: 1px) { a { color: red; } }";
		expect(ungatedForcedColors(css)).toHaveLength(1);
	});

	it("requires a positive support ancestor, with no OR escape", () => {
		const forced = "@media (forced-colors) { a { color: Highlight; } }";
		expect(
			ungatedForcedColors(
				`@supports (forced-color-adjust: auto) and (display: grid) { ${forced} }`,
			),
		).toEqual([]);
		expect(
			ungatedForcedColors(`@supports (forced-color-adjust: auto) or (display: grid) { ${forced} }`),
		).toHaveLength(1);
		expect(
			ungatedForcedColors(`@supports not (forced-color-adjust: auto) { ${forced} }`),
		).toHaveLength(1);
	});

	it("does not treat negated support for another value as the palette gate", () => {
		expect(
			ungatedForcedColors(
				"@supports not (forced-color-adjust: none) { @media (forced-colors) { a { color: Highlight; } } }",
			),
		).toHaveLength(1);
	});

	it("ignores condition-like strings and comments", () => {
		expect(
			ungatedForcedColors(
				'/* @media (forced-colors) { */ a { content: "@media (forced-colors) {"; }',
			),
		).toEqual([]);
	});

	it.each([
		'.broken { --probe: "unterminated\n; }\n@media (forced-colors: active) { a { color: Highlight; } }\n/* " */',
		'.b{content:"a\n}\n@media (forced-colors: active){a{color:Highlight}}\n.c{content:"}',
	])("rejects malformed CSS rather than hiding a media rule: %s", (css) => {
		expect(() => ungatedForcedColors(css)).toThrow();
	});

	it("does not confuse an unquoted URL brace with a grouping rule", () => {
		const css =
			"@supports (forced-color-adjust: auto) { .x { background: url(a{b.png) } } @media (forced-colors) { a { color: Highlight; } }";
		expect(ungatedForcedColors(css)).toHaveLength(1);
	});

	it("does not ship retired React video facade or upgrade overlay selectors", async () => {
		const result = await build({
			entryPoints: [path.resolve(import.meta.dirname, "../../template/src/styles/viewer.css")],
			bundle: true,
			write: false,
			minify: true,
			target: "es2020",
			legalComments: "none",
		});
		// A returning selector needs a current emitter and its own output contract first.
		expect(result.outputFiles[0].text).not.toMatch(
			/\.praxity-video-(?:facade(?:-play)?|gated-(?:content|link|overlay|play|text)|poster)(?![\w-])/,
		);
	});

	it("keeps viewer-owned reading toolbar selectors out of global CSS", () => {
		const classes = (css: string) =>
			new Set([...css.matchAll(/\.praxity-[a-zA-Z0-9_-]+/g)].map(([name]) => name));
		const globalClasses = classes(globalCss);
		const overlap = new Set([...classes(viewerCss)].filter((name) => globalClasses.has(name)));

		expect(overlap.has(".praxity-a11y-pill")).toBe(false);
		expect(viewerCss).toMatch(/\.praxity-a11y-pill button:hover,[^{]*\{/s);
		expect(viewerCss).toMatch(/\.praxity-a11y-pill button:focus-visible,[^{]*\{/s);
		expect(viewerCss).toMatch(/\.praxity-a11y-pill button\[data-active\],[^{]*\{/s);
		expect(viewerCss).toContain("@media (prefers-contrast: more)");
		const pillRule = [...viewerCss.matchAll(/\.praxity-a11y-pill\s*\{([^}]*)\}/gs)]
			.map((match) => match[1])
			.find((rule) => rule.includes("border: 2px"));
		expect(pillRule).toContain("border: 2px solid transparent");
		expect(pillRule).not.toContain("border-color:");
		expect(viewerCss).not.toContain(".praxity-a11y-pill button + button");
	});

	it("keeps the floating TOC in the always-loaded viewer stylesheet", () => {
		expect(globalCss).not.toContain(".praxity-floating-toc");
		expect(globalCss).not.toContain(".praxity-toc-");
		expect(viewerCss).toContain(".praxity-floating-toc");
		expect(viewerCss).toContain(".praxity-toc-bar:focus-visible");
	});

	it("keeps scroll progress and narrative chrome in the shared viewer stylesheet", () => {
		for (const selector of [
			".praxity-scroll-progress",
			".praxity-scroll-progress-fill",
			".praxity-narrative-bar",
			".praxity-narrative-bar-text",
		]) {
			expect(globalCss).not.toContain(selector);
			expect(viewerCss).toContain(selector);
		}
		expect(viewerCss).toMatch(
			/\.praxity-scroll-progress,\s*\.praxity-pages-progress\s*\{[^}]*height:\s*4px/s,
		);
		expect(mediaContents(viewerCss, "(prefers-reduced-motion: reduce)")).toContain(
			".praxity-scroll-progress-fill",
		);
		expect(mediaContents(viewerCss, "(max-width: 768px)")).toContain(".praxity-narrative-bar");
	});

	it("keeps entrance motion in shared block CSS", () => {
		expect(globalCss).not.toContain("data-entrance");
		expect(blocksCss).toContain("--praxity-stagger-step: 10ms");
		expect(blocksCss).toContain("--praxity-stagger-cap: 5");
		expect(blocksCss).toContain(".praxity-stats-item");
		expect(blocksCss).toMatch(
			/\.praxity-block\[data-entrance="visible"\][^{]*\{[^}]*transition:\s*opacity var\(--duration-state\) var\(--ease-out\),\s*transform var\(--duration-state\) var\(--ease-out\);/s,
		);
		expect(blocksCss).toContain(
			"min(var(--praxity-stagger-index, 0), var(--praxity-stagger-cap, 5))",
		);
		const reducedMotionCss = mediaContents(blocksCss, "(prefers-reduced-motion: reduce)");
		expect(reducedMotionCss).toContain("data-entrance");
		expect(reducedMotionCss).toContain("transition: none");
	});

	it("disables Card transitions for OS and learner reduced motion", () => {
		const reducedMotionCss = mediaContents(blocksCss, "(prefers-reduced-motion: reduce)");
		const transitionSelector = String.raw`\.praxity-slides-grid:is\(\s*\[data-transition="fade"\],\s*\[data-transition="slide"\],\s*\[data-transition="zoom"\]\s*\)\s+\.praxity-slides-item`;
		for (const [css, prefix] of [
			[reducedMotionCss, ""],
			[blocksCss, String.raw`\[data-praxity-reduced-motion\]\s+`],
		]) {
			const rule = css.match(
				new RegExp(`${prefix}${transitionSelector}\\s*\\{([^}]*)\\}`, "s"),
			)?.[1];
			expect(rule).toContain("transition: none");
			expect(rule).toContain("transform: none");
		}
	});

	it("dims complete reading-guide rows without painting a veil", () => {
		const dimmedRule = viewerCss.match(
			/\[data-focus-row\]\[data-focus-dimmed\]\s*\{([^}]*)\}/s,
		)?.[1];
		expect(dimmedRule).toContain("opacity: 0.15");
		expect(viewerCss).not.toContain("[data-focus-row][data-focus-dimmed]::after");
	});

	it("uses the document as the desktop content scroller", () => {
		expect(viewerCss).toMatch(/grid-template-rows:\s*var\(--praxity-toolbar-height\)\s+1fr\s+auto/);
		expect(viewerCss).not.toMatch(
			/\.praxity-viewer-shell\.praxity-layout-sidebar \.praxity-layout-wrapper\s*\{[^}]*\bheight:\s*100dvh/s,
		);
		expect(viewerCss).not.toMatch(
			/\.praxity-layout-sidebar #main-content\s*\{[^}]*overflow-y:\s*auto/s,
		);
		expect(viewerCss).toMatch(/\.praxity-top-bar\s*\{[^}]*position:\s*static/s);
	});

	it("keeps navigation chrome clear of narrow content", () => {
		const touchCss = mediaContents(viewerCss, "(max-width: 1024px)");
		expect(touchCss).toMatch(/\.praxity-edge-arrow-nav\s*\{[^}]*display:\s*none/s);
		expect(viewerCss).toMatch(/\.praxity-hamburger\s*\{[^}]*top:\s*4px/s);

		for (const css of [globalCss, viewerCss]) {
			const disabledNavRule = [
				...css.matchAll(
					/\.praxity-page-nav \.mantine-Button-root\[data-disabled\],[^{]+\{([^}]*)\}/gs,
				),
			]
				.map((match) => match[1])
				.find((rule) => rule.includes("--button-bg"));
			expect(disabledNavRule).toContain("--button-bg: transparent");
			expect(disabledNavRule).toContain("background: var(--button-bg)");
			expect(disabledNavRule).toContain("opacity: 0.47");
		}
	});

	it("keeps native navigation stable before hydration and mirrors its directional chrome", () => {
		expect(viewerCss).toMatch(
			/\.praxity-native-page-nav,\s*\.praxity-native-page-nav\[data-hydrated\]\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*padding:\s*0;/s,
		);
		expect(viewerCss).toMatch(/\.praxity-mobile-top-bar\s*\{[^}]*display:\s*none;/s);
		expect(viewerCss).toMatch(
			/html\.praxity-js \.praxity-mobile-top-bar:has\(\.praxity-native-menu-toggle\)\s*\{[^}]*display:\s*block;/s,
		);
		expect(viewerCss).toMatch(/\.praxity-hamburger\[hidden\]\s*\{[^}]*display:\s*none;/s);
		expect(viewerCss).toMatch(
			/\[dir="rtl"\] \.praxity-outline-drawer\s*\{[^}]*transform:\s*translateX\(100%\);/s,
		);
		expect(viewerCss).toMatch(/\.praxity-edge-arrow--prev\s*\{[^}]*inset-inline-start:/s);
		expect(viewerCss).toMatch(/\.praxity-edge-arrow--next\s*\{[^}]*inset-inline-end:/s);
	});

	it("uses a neutral scroll join and an elongated current progress dot", () => {
		expect(globalCss).toMatch(
			/body\.praxity-layout-scroll \.praxity-page-nav\s*\{[^}]*border-top:\s*1px solid var\(--praxity-color-border/s,
		);
		for (const css of [globalCss, viewerCss]) {
			expect(css).toMatch(/\.praxity-progress-dot\.is-current\s*\{[^}]*width:\s*20px/s);
			expect(mediaContents(css, "(prefers-reduced-motion: reduce)")).toContain(
				".praxity-progress-dot",
			);
		}
	});

	it("keeps published video and iframe media responsive", () => {
		expect(blocksCss).toMatch(
			/\.praxity-video > :is\(video, iframe\)\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*aspect-ratio:\s*16 \/ 9;/s,
		);
	});

	it("does not draw a rule under the narrative duration", () => {
		const rule = viewerCss.match(/\.praxity-narrative-bar\s*\{([^}]*)\}/s)?.[1];
		expect(rule).not.toContain("border-bottom");
	});

	it("uses one tokenized material for activities", () => {
		const activityRule = blocksCss.match(
			/\.praxity-block-assessment:not\(\.praxity-block\)\s*\{([^}]*)\}/s,
		)?.[1];
		expect(activityRule).toContain("background: var(--praxity-color-activity-surface)");
		expect(activityRule).toContain("border: 1px solid var(--praxity-color-activity-border)");
	});

	it("uses text-safe button and Mantine hover roles", () => {
		for (const css of [globalCss, viewerCss]) {
			const buttonAncestor =
				css === viewerCss
					? String.raw`:is\(\[data-block-type="button"\],\s*\[data-block-type="document"\],\s*\[data-block-type="assessment"\]\)`
					: String.raw`\[data-block-type="button"\]`;
			const button = `${buttonAncestor}\\s+\\.mantine-Button-root`;
			const filledRule = css.match(new RegExp(`${button},[\\s\\S]*?\\{([^}]*)\\}`))?.[1];
			const outlineRule = css.match(
				new RegExp(`${button}\\[data-variant="outline"\\][\\s\\S]*?\\{([^}]*)\\}`),
			)?.[1];
			const lightRule = css.match(
				new RegExp(`${button}\\[data-variant="light"\\][\\s\\S]*?\\{([^}]*)\\}`),
			)?.[1];
			expect(filledRule).toContain("color: var(--button-color) !important");
			expect(outlineRule).toContain("--praxity-color-accent-text");
			expect(lightRule).toContain("--praxity-color-accent-text");
			expect(lightRule).toContain("--button-hover: var(--praxity-color-background-alt)");
		}

		expect(sharedProvider).toContain(
			'"--mantine-color-accent-light-hover": "var(--praxity-color-accent-light)"',
		);
	});

	it("keeps assessment controls usable across their full visual row", () => {
		expect(blocksCss).toMatch(
			/\.praxity-assessment-choice-option,\s*\.praxity-ag-radio-row\s*\{[^}]*position:\s*relative/s,
		);
		expect(blocksCss).toMatch(
			/\.praxity-assessment-choice-option[\s\S]*?:is\(\.mantine-Radio-label, \.mantine-Checkbox-label\)::after,[\s\S]*?\{[^}]*position:\s*absolute[^}]*inset:\s*0/s,
		);
		expect(blocksCss).toMatch(
			/\.praxity-assessment-choice-option :is\(\.mantine-Radio-inner, \.mantine-Checkbox-inner\)\s*\{[^}]*z-index:\s*1/s,
		);
		expect(blocksCss).toMatch(
			/\.praxity-block-assessment\[data-assessment-group\] \[data-assessment-submit="true"\]\s*\{[^}]*display:\s*none/s,
		);
		expect(blocksCss).toMatch(
			/\.praxity-ag-submit-btn\s*\{[^}]*min-block-size:\s*var\(--target-size\)/s,
		);
		expect(blocksCss).toMatch(
			/@container preview-content \(max-width: 480px\)\s*\{[^}]*\.praxity-ag-submit-btn,[^}]*inline-size:\s*100%/s,
		);
	});

	it("reserves activity borders for controls and decorative borders for dividers", () => {
		const controlRules = [
			blocksCss.match(/\.praxity-ag-radio\s*\{([^}]*)\}/s)?.[1],
			blocksCss.match(/\.praxity-block-assessment \.mantine-Checkbox-input,[^{]*\{([^}]*)\}/s)?.[1],
			blocksCss.match(/\.praxity-assessment-select-input,[^{]*\{([^}]*)\}/s)?.[1],
		];
		for (const rule of controlRules) {
			expect(rule).toContain("--praxity-color-activity-border");
			expect(rule).not.toContain("--praxity-color-border");
		}
		expect(blocksCss.match(/\.praxity-assessment-select-dropdown\s*\{([^}]*)\}/s)?.[1]).toContain(
			"box-shadow: none",
		);
		expect(blocksCss.match(/\.praxity-assessment-select-option\s*\{([^}]*)\}/s)?.[1]).toContain(
			"white-space: normal",
		);
		// The matching connector is gone: adjacency in the grid is the pairing,
		// and a 24px dash spanning nothing read as an artifact.
		expect(blocksCss).not.toContain("praxity-matching-connector");
	});

	it("keeps the note label inline and the warning symbol at 20px", () => {
		expect(blocksCss).toMatch(/\.praxity-note-label\s*\{[^}]*display:\s*inline/s);
		expect(blocksCss).toMatch(/\.praxity-note-icon\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/s);
		expect(blocksCss).not.toContain("praxity-note-surface-high");
	});

	it("leaves assessment focus indication to the shared keyboard ring", () => {
		for (const css of [globalCss, viewerCss]) {
			expect(css).toContain(".praxity-page-content :is(input, select, textarea):focus-visible");
		}
		for (const css of [globalCss, blocksCss]) {
			const rule = css.match(
				/\.praxity-block-assessment \.mantine-Textarea-input:focus,[^{]*\{([^}]*)\}/s,
			)?.[1];
			expect(rule).not.toContain("outline:");
		}
	});

	it("uses platform contrast modes without retaining a bespoke theme", () => {
		for (const css of [globalCss, viewerCss, blocksCss]) {
			expect(css).not.toContain("data-praxity-high-contrast");
			expect(css).not.toContain("forced-color-adjust: none");
		}
		const moreCss = [viewerCss, blocksCss]
			.map((css) => mediaContents(css, "(prefers-contrast: more)"))
			.join("\n");
		expect(moreCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(viewerCss).toContain("@media (prefers-contrast: more)");
		expect(viewerCss).toContain("@media (forced-colors: active)");
		expect(viewerCss).toMatch(/\.praxity-file-type\s*\{[^}]*font-size:\s*var\(--type-small\)/s);
		expect(viewerCss).toMatch(/\.praxity-external-icon\s*\{[^}]*width:\s*0\.75em/s);

		expect(viewerCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--focus-width\) solid/s);
		expect(moreCss).toContain(
			"--praxity-color-activity-border: var(--praxity-color-text) !important",
		);
		expect(moreCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--focus-width\) solid/s);
		for (const selector of [
			".mantine-TextInput-input",
			".mantine-Checkbox-input",
			".praxity-data-table",
			".praxity-card-outline",
			".praxity-divider-line",
			".praxity-order-item + .praxity-order-item",
			".praxity-assessment-choice-option:has",
			".mantine-Radio-radio:checked",
			".praxity-required-ring",
			'.praxity-fill-blank-input[aria-invalid="true"]',
			'[data-result="incorrect"]',
			"[data-focus-dimmed]",
		]) {
			expect(moreCss, selector).toContain(selector);
		}
		expect(moreCss).not.toContain(".praxity-assessment-group-card");
	});

	it("keeps the disclosure focus ring themed with a platform fallback in contrast modes", () => {
		const contrastCss = mediaContents(viewerCss, "(prefers-contrast: more)");
		const disclosureRule = contrastCss.match(
			/\.praxity-disclosure-trigger\[aria-controls\]:focus-visible\s*\{([^}]*)\}/g,
		);
		expect(disclosureRule?.join("\n")).toContain(
			"outline-color: var(--praxity-color-focus, Highlight) !important",
		);
	});

	it("underlines authored prose links without changing card or button links", () => {
		expect(viewerCss).toContain(".praxity-viewer-shell .praxity-text,");
		expect(viewerCss).toContain(".praxity-viewer-shell .praxity-text-content,");
		expect(viewerCss).toMatch(
			/\.praxity-quote\s*\n\s*\)\s*a\s*\{[^}]*text-decoration:\s*underline/s,
		);
		expect(viewerCss).not.toMatch(/\.praxity-page-content\)\s+a\s*\{/);
	});

	it("scales learner badges and assessment results and styles required groups", () => {
		expect(blocksCss).toMatch(/\.praxity-accent-badge\s*\{[^}]*font-size:\s*var\(--type-small/s);
		expect(blocksCss).toMatch(
			/\.praxity-code-language-badge\s*\{[^}]*font-size:\s*var\(--type-small/s,
		);
		expect(globalCss).toMatch(/\.praxity-ag-review-links\s*\{[^}]*font-size:\s*var\(--type-small/s);
		expect(globalCss).toMatch(
			/\.praxity-ag-results-score\s*\{[^}]*font-size:\s*var\(--type-small/s,
		);
		expect(blocksCss).toMatch(
			/\.praxity-required-ring\s*\{[^}]*outline:\s*var\(--focus-width\) solid/s,
		);
	});
});
