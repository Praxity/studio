# 0040: Export test browser measurements

## Status

Accepted. Records existing test constraints; no executable change.

## Context

Export tests include platform observations, fixture admission rules and measured allowances that are not apparent from their assertions. The records below preserve that context when code comments are removed. Platform observations describe the harness versions recorded by the tests; they are not new compatibility claims.

## Decision

### packages/export-pipeline/tests/a11y/activity-details.spec.ts

- `targetHeight`: Firefox loses precision when Playwright serializes the rectangle coordinates.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `open`: Separate independent journeys: WebKit's light desktop frame waits exhaust a combined 30s test.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/block-presentation.spec.ts

- `'stat and image caption reflow at ${width}px'`: Gecko's DOMRects can report an 8px gap as 7.999969482421875px. Keep the 8px minimum exact and verify that layout preserves that margin.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/choice-baselines.ts

- `choiceBaselines`: A zero-size inline box exposes the actual text baseline, independent of glyph ascent or the line box's top. The generated key is measured with an equivalent text child; its dimensions must stay identical while the probe is installed.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/choice-control-alignment.spec.ts

- `markerMeasurements`: Zero-width baseline probes expose the font's ex/cap metrics without relying on the height of a line box or the particular letters in an answer.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `levelLimit`: Below 360 px, --type-body clamps to 16 px while the key stays 15 px, leaving 0.5 * |key cap - text x-height| = 1.07 px. 1.25 px holds that worst case. See packages/shared-blocks/src/reading-rhythm.css.
- `intercepted`: WebKit can reuse a warmed preload without invoking a late route. Hold the loader before this context's first course navigation.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'marker layout evidence ${condition.name}'`: Locator.click treats the disabled radio's label as disabled. A real pointer can still pin its text through the capture listener.
- `lineHeight`: The nested choice span can have a taller line height than Mantine's label and expands the actual first line box. Native labels use their own line height because they have no nested choice span.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `firstLineCenter`: Mantine's block label box starts at its first line box. Glyph bounds differ across font engines, so alignment uses the CSS line box.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `paint`: Canvas converts rgb/oklch to the same sRGB bytes and composites alpha.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `probe`: Animation reports alone can miss a newly selected fill. Resolve its owning CSS token and wait for the actual painted colour too.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `selectThroughRowAndWrapper`: The invisible native radio covers the key, so hit its painted position through the enclosing label rather than asking the key to receive events.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `choice paint waits for the generated key fill even without animation reports`: Reproduce missing browser animation reports while the real CSS colour transition still runs. The measurement must wait for the selected fill.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'choice controls align at ${width}px with ${textSize} text'`: fonts.ready also waits for document loading. The paused deferred loader deliberately keeps that pending until SSR is measured.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/continue-gate.spec.ts

- `pointer, Enter, AT-style activation, modified click, shortcut, swipe and outline jumps stay blocked`: Playwright intentionally refuses pointer activation of aria-disabled controls.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/contrast-themes.spec.ts

- `prefers-contrast strengthens boundaries without replacing the theme`: Playwright 1.59 / firefox-1511 updates matchMedia for contrast emulation without restyling existing sheets. A new document applies the preference. After reload, recreate the probes and preserve the contrast and axe assertions in this test.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/design-navigation.spec.ts

- `'${mode} card transition default reaches the active slide deck'`: The global reduced-motion guard permits 0.01ms to preserve transition events.

### packages/export-pipeline/tests/a11y/design-system.config.ts

- `defineConfig`: External review exports are served by the capture runner. Normal a11y CI uses the canonical setup and public fixtures through playwright.config.ts.

### packages/export-pipeline/tests/a11y/design-system.spec.ts

- `previousOutlineLink`: Safari's default Tab order includes links with Option (Alt). https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac

  Evidence: the Apple keyboard-shortcuts page linked in this decision documents Option-Tab traversal. It does not establish the Windows Playwright focus exclusions recorded elsewhere.
- `recordSmoothScroll`: Native scrolling is not reported by getAnimations(). Record requests before any runtime loads so the reduced-motion tests also observe native scrolling.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'course outline ${presentation} ${palette} ${mode}'`: Reach the first row by keyboard; programmatic focus can retain mouse modality.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `activeTimings`: The browser owns active timing, including WAAPI effects and CSS repetition.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `active`: Browser timings in seconds can leave a last-digit binary roundoff at 300ms.
- `first`: Heading font bounds can exceed their 1.2 line box. Measure reading space from the laid-out line box, not the font's invisible ascenders.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'look v2 activity and reading tokens at ${width}px'`: Firefox does not implement `pretty`; it keeps the default wrap there.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'rule 12 keeps assessment ordering icons still ${reducedMotion}'`: Set the preference before rendering so a media change cannot hide Mantine's timing.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'feedback summary has only a top rule and preserves focus at ${width}px'`: WebKit's programmatic focus uses its native outline until keyboard traversal.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `bounds`: Firefox protocol quads lose precision when subtracting large positions (44 becomes 43.999969). DOMRect retains the CSS size.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/dialogue-branching.spec.ts

- `submission reveals a branch and retry keeps Play in authored order`: A source change precedes decoded playback. Start retry only once the real clock advances, with a clip longer than this test's entire 30-second budget.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/dialogue.spec.ts

- `'bubble inline avatars ${presentation} ${direction} under 20rem'`: Firefox DOMRect subtraction can report 3.99998 for the 4px CSS gap.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `probe`: CSSOM exposes offsets within an absolute grid area, not the li. A temporary absolute probe measures those same used properties.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/disclosures.spec.ts

- `findDisclosurePage`: The comprehensive fixture contains third-party embeds. These checks are local.

### packages/export-pipeline/tests/a11y/fixture-builds.ts

- `runFixtureBuilds`: All writers settle before setup can remove their shared output directory.

### packages/export-pipeline/tests/a11y/fixtures/container-layouts-fixture.ts

- `containerLayoutsFixture`: These publisher controls remain supported in stored models. They have no G4 spelling; retain their original values after reading valid G4 content.

### packages/export-pipeline/tests/a11y/fixtures/design-colors-typography-fixture.ts

- `designColorsTypographyFixtures`: Stored text HTML uses this existing error renderer; inert previews do not run learner validation.

### packages/export-pipeline/tests/a11y/fixtures/design-container-surfaces-fixture.ts

- `designContainerSurfaceFixtures`: Retain the one-column surface samples supported by the publisher's stored model; G4 source accepts card grids with two to four columns.

### packages/export-pipeline/tests/a11y/fixtures/highlight-published.ts

- `highlightPublisher`: Build the production CLI once per spec. xAPI has no CLI flag, so use its existing source-input and deployment owners with the same saved course.
- `highlightPublisher`: Each file keeps a captured asset set while other checks may rebuild the checkout.

### packages/export-pipeline/tests/a11y/fixtures/learner-polish-fixture.ts

- `blankPanelPng`: A blank image shows whether its edge stays visible on a pale page. A photo would make the edge pixels depend on the picture.
- `buildLearnerPolishCourse`: Campfire with a grain texture: the textured page where the skip link escaped.

### packages/export-pipeline/tests/a11y/fixtures/lightweight-fixture.ts

- `resolveFixtureAssets`: Point fixture images at the deterministic download stub in global setup. The image used to be `https://images.unsplash.com/…`, fetched at build time by `resolveAssets`. A slow or failing response threw, killed global setup, and left the suite running against a stale `.test-env.json` — a whole run reporting on an export nobody had just built. The document fixture keeps its remote URL to exercise the asset resolver and retain document coverage. Global setup serves the fixture URLs from disk instead — see `stubFixtureDownloads`.
- `LIGHTWEIGHT_GRAMMAR`: Minimal 3-page fixture: - Page 1: static (text + image) - Page 2: interactive (accordion + tabs) - Page 3: assessment (choice + assessment-group)
- `documentBlock`: G4 has no document syntax. Keep the publisher's document coverage at its model interface while all authored source in this fixture goes through the G4 reader.
- `NAV_TOGGLES`: The chrome each variant actually ships. Exported because the specs used to keep their own hand-written table of what should be visible, which drifted from this one — every nav expectation now derives from here.
- `buildSlidesNarrationCourse`: Narration is sidecar/model data in G4. Keep the optional audio journey on the same slide and leave its complete text available without playback.

### packages/export-pipeline/tests/a11y/fixtures/radius-roles-fixture.ts

- `radiusRolesFixture`: Grammar accepts up to ten scale labels; the renderer also accepts an eleven-key model.

### packages/export-pipeline/tests/a11y/fixtures/retrieval-sheet-harness.ts

- `prepared`: The suite's global setup (or focused runner) prepares the viewer once. Worker restarts reuse those bytes; no full viewer build happens in this file.

### packages/export-pipeline/tests/a11y/global-setup.ts

- `globalSetup`: The design-system capture runner already serves fresh scratch exports.
- `stubFixtureDownloads`: Serve the fixture's remote assets from disk. `resolveAssets` downloads remote assets at build time, so the suite depended on example.com answering. When it 404'd, the build threw, this setup died, and the run continued against a stale `.test-env.json` — reporting on an export nobody had just built, which is how a flake became a wrong diagnosis. The document URL remains remote to exercise the asset resolver. The audio and image URLs exercise the same resolver path used by authored media. Unexpected requests fail without reaching the network.
- `tenseAudio`: Retry must pause only when the next answer hides the playing branch. A 60-second PCM clip outlasts the test's 30-second budget, so natural completion cannot race that assertion. Generate silence locally instead of borrowing a speech sample whose duration can change independently of this journey.

### packages/export-pipeline/tests/a11y/helpers.ts

- `LAYOUT_UNIT`: Firefox uses 1/60px layout units; serialized rectangle differences can fall one unit short.

  Evidence: Mozilla's [AppUnits.h](https://github.com/mozilla/gecko-dev/blob/master/gfx/src/AppUnits.h), `AppUnitsPerCSSPixel`, defines 60 app units per CSS pixel. The serialization-shortfall observation is from the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `textFitsWithin`: Linux WebKit measured RTL text ending at 296.0000305px inside a 296px link, a 0.00003px serialization overrun. Allow only one layout unit on either edge.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `DISCOVERY_SELECTORS`: SSR selector inventory for direct addressing. Visibility and hydration are still checked in the browser; compiled absence cannot be a timing miss.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `waitForHydration`: Waits for the shell and navigation only. Reveal lazy blocks and await their own data-hydrated marker before interacting with or measuring their rendered content.
- `waitForHydration`: Hydration can finish during an authored entrance. Measure contrast after visible rows reach their final opacity, keeping off-screen rows pending.
- `waitForSettledStyles`: Visibility and hydration precede the final paint. Include ancestors via document.getAnimations(), and recheck after another frame for chained motion.
- `results`: Courses embed third-party players. Without this, axe descends into their cross-origin documents and reports violations in markup we cannot fix -- and only when the embed happens to have loaded, so the suite fails about one run in three. Our own iframe elements are still checked.
- `ownerSelector`: Hydrate only an owning island. Generated controls must not be probed before its import has completed, nor should unrelated blocks be woken.
- `WEBKIT_TAB_ORDER_SKIP`: Reason string for skipping sequential-Tab assertions outside Chromium. Playwright's WebKit ships WebKit's default focus model: Tab reaches form fields only, and skips `<a href>` and `<button>` entirely. Verified 2026-08 with a probe page containing all three -- Chromium tabbed link -> button -> input, WebKit tabbed to the input alone. On real macOS this is governed by two *user settings* (System Settings -> Keyboard -> Keyboard Navigation, and Safari -> Settings -> Advanced -> "Press Tab to highlight each item on a webpage"), neither of which Playwright exposes, so a Tab-order assertion here measures the harness, not the page. Do NOT "fix" this by adding `tabindex="0"` to native controls -- that is a widely circulated non-fix, unreliable even in Safari, and it breaks roving-tabindex widgets. Follow the keyboard requirements in `docs/rules/a11y-checklist.md`. WebKit tab-order verification is manual, with Full Keyboard Access on. Everything else in this suite -- axe, contrast, landmarks, headings, interactions, text spacing -- still runs in both engines, which is where the WebKit-only defect classes actually show up.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/highlight-baseline.spec.ts

- `French baseline wraps at 400% with text spacing and reduced motion`: addStyleTag waits for a script-driven load event in a no-JavaScript context.

### packages/export-pipeline/tests/a11y/highlight-delivery.spec.ts

- `offline file delivery uses the classic highlight adapter`: Firefox does not expose every file:// script through Playwright request events. Only the executed classic bundle publishes this adapter on window.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/highlight-enhance.spec.ts

- `test.beforeEach`: Location.hash is non-configurable, so observe fragment writes instead.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/highlight-print.spec.ts

- `compact`: PDF extractors may omit a space at a line boundary. Count every authored non-whitespace character, including all repeated punctuation, on both projections.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/highlight-published.spec.ts

- `'${format} deck=${deck} ${lang}: published activity has no writes and ordinary choice reports'`: Module decks refuse authored variables/logic. Their separate API control remains explicit; ordinary pages use only the authored rule above.

### packages/export-pipeline/tests/a11y/highlight-reporting.spec.ts

- `highlightHostFormats`: A future host, including cmi5, must add a privacy proof before this typecheck passes.

### packages/export-pipeline/tests/a11y/hotspot-regions.spec.ts

- `tab`: WebKit on macOS skips buttons on plain Tab unless Full Keyboard Access is on.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/inline-features.spec.ts

- `copied`: Windows converts newlines in the native clipboard. Verify the API input exactly, then compare native read-back with only CRLF conversion removed.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/interactions.spec.ts

- `keyboard checklist and media use one themed control ring`: Native media may put Tab focus on an internal player control.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `gradingMode`: data-passed/data-score only exist on graded assessments; knowledge checks deliberately omit them (AssessmentBlock.tsx).
- `block`: The static wrapper from render-block-html.ts and the hydrated React Card share the .praxity-block-assessment class, so .first() would match the wrapper, which never carries the graded attributes. data-assessment-display is set only by the Card (AssessmentBlock.tsx).
- `layoutClass`: A page may switch its chrome off with `nav: minimal` / `nav: none`, a page-break param added after this walk was written. Those pages have no next control to click, so step over them by URL rather than assert one exists — the rest of the lifecycle is still what this test is for.
- `layoutClass`: Same as the forward walk: a chromeless page has no control to click.

### packages/export-pipeline/tests/a11y/keyboard-nav.spec.ts

- `activateNextPage`: WebKit can return from press() before the new document starts loading.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `Enter reaches the next page when its response is delayed`: Keep WebKit on the loaded source document until the destination responds.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `tabs, assessment, and page navigation keyboard behavior`: Playwright WebKit skips native links in sequential Tab order. Real Safari needs macOS Keyboard Navigation and its "Press Tab to highlight each item on a webpage" setting. Seed focus for Enter activation below.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/landmarks.spec.ts

- `layoutClass`: A page may turn its chrome off — `nav: minimal` and `nav: none` are page-break params, added after this spec was written, and the fixture uses `minimal` on one page. Those layouts navigate by keyboard arrows, swipe and progress dots, none of which is a landmark, so requiring one there asserted a bug that isn't.

### packages/export-pipeline/tests/a11y/learner-polish.spec.ts

- `deltaE`: OKLab distance; about 0.02 is the smallest step people reliably see.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `sequentialTab`: Playwright's WebKit Tab skips links (see WEBKIT_TAB_ORDER_SKIP), so WebKit checks the focused link's painting and activation; the other engines also prove Tab reaches it.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `island`: The stem re-renders when its lazy island hydrates; measure the settled text.
- `walker`: Word ranges avoid counting inline element boxes as full lines.
- `legendLayout`: The visible chart's legend parts in its own user units. Text is measured per character because WebKit reports a tspan's bounding box as its whole text run.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `learner polish surfaces`: Two device pixels per CSS pixel keep a 1px edge as a whole painted pixel.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `ink`: Text is the pixel furthest from the field: darker on light fields, lighter on dark.

### packages/export-pipeline/tests/a11y/narration-toolbar.spec.ts

- `'sidebar narration stays grouped and operable at ${width}px'`: macOS WebKit uses Option+Tab to include buttons in keyboard navigation.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/narrow-answerability.spec.ts

- `'${theme} data table gives scroll cues and retains keyboard scrolling'`: Windows headless Firefox resolves even a native `thin` scrollbar to `none`. Check the published declaration and compare rendering with a native control.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/nav-a11y.spec.ts

- `NAV_VARIANTS`: Derived from the fixture's toggles rather than restated. The table this replaces expected a visible nav landmark for every archetype but `none` — including `minimal`, whose whole point is that it hides the outline and prev/next. Only the outline and prev/next render as `<nav>`; edge arrows and the hamburger are buttons, so they do not add a landmark.
- `effective`: What the learner actually gets: the archetype's preset, with the fixture's overrides on top — the same merge the viewer performs.
- `NAV_VARIANTS`: Only the outline, prev/next and the slides layout's own slide-nav render as `<nav>`. Edge arrows, the hamburger and the progress dots are buttons, so they navigate without adding a landmark — which is why `minimal` correctly exposes none.
- `WINDOWS_WEBKIT_LINK_TRAVERSAL`: Windows WebKit excludes native link Tab traversal in sidebar, bottombar, slides, scroll and embedded layouts; skip-link activation is covered separately.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `spokenAs`: Chromium may add a space at the hidden marker's boundary; the text itself has none. These names are plain words, so they need no regex escaping.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/nav-configs.spec.ts

- `NAV_VARIANTS`: Derived from the fixture's own toggles, not restated here. The hand-written table this replaces claimed minimal shows prev/next and that sidebar shows an outline, while the fixture turned the first off and the viewer renders the second under a different class after hydration — four specs failed for two years' worth of drift rather than any product defect.

### packages/export-pipeline/tests/a11y/outline-regressions.spec.ts

- `'course outline forced colours ${presentation} ${direction} ${width}'`: Drawer entry moves focus on the next frame. Let that finish before exercising keyboard navigation between rows.
- `tab`: Safari's Option+Tab includes native links on macOS.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/playwright.config.ts

- `defineConfig`: Linux WebKit occasionally aborts a `page.goto` with "WebKit encountered an internal error" (seen on design-navigation's repeated navigations). One CI retry absorbs that crash; Playwright still reports the test as flaky.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `defineConfig`: Published output reaches learners through Chromium, WebKit (Safari), and Gecko (Firefox, including NVDA). Keyboard, focus and visual-state defects can be reproducible in only one engine. Keep Chromium, WebKit and Firefox in the published-output engine matrix.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `defineConfig`: Only Chromium accepts --mute-audio; Linux WebKit refuses to launch with it.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `defineConfig`: Mute at the media element, so headless hosts without an audio device keep decoding and advancing on Gecko's system clock. media.volume_scale alone still opens the failing audio sink.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/reading-palette-interactions.spec.ts

- `heading`: Arrival orients through heading focus alone. Without session storage the focus request cannot cross the document load, so arrival behaves like a direct visit and the reader starts at the document title.
- `Reading guide still dims inactive content and clears the effect when disabled`: A compact no-hover page that fits without scrolling intentionally leaves all rows readable. Linux headless Firefox reports no hover (Mozilla bug 2037020), so exercise the guide on a scrollable page rather than assuming mouse input.

  Evidence: the replaced comment cites [Mozilla bug 2037020](https://bugzilla.mozilla.org/show_bug.cgi?id=2037020). The reported no-hover behaviour is from the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/recall-card.spec.ts

- `'recall commit ${mode} ${width}'`: Pause the real transitions in the activation turn, before slow cross-engine assertions can outlast its 200ms duration.
- `'recall commit ${mode} ${width}'`: Safari's Option+Tab includes native links on macOS.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/retrieval-sheet-baseline.spec.ts

- `test.beforeAll`: The read-only matrix navigates afresh for every case. Share the content process, fonts and scanner warm-up so cold engine work stays outside the per-case budget.
- `'${lang} ${mode}: both sides remain styled with JavaScript disabled at ${width}px'`: Chromium can fetch the existing shell preload with scripting disabled. No retrieval enhancer or other executable dependency is requested.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/retrieval-sheet-print.spec.ts

- `entry`: Observe entry before exit so Firefox cannot coalesce both emulated changes.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `probePrintPaint`: Gecko still hits MAIN under print media after observed media entry, scrolling and a frame. The test still requires native visibility and bounding-box checks.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'scoped print fully exposes ${placement} while retaining its screen state'`: Playwright's WebKit :visible fallback rejects closed details even when print CSS exposes ::details-content. Use the browser's visibility check.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'${lang} ${rows} rows ${format} print flow'`: PDF paper sizes in points; allow Chromium's device-pixel rounding.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/sidebar-feedback-visibility.spec.ts

- `expectControlPainted`: Forced colours paint the user's Highlight colour, which can be below 3:1.

### packages/export-pipeline/tests/a11y/small-previews.spec.ts

- `'${name}: expanding preview reports natural height and shrinks after long content'`: Advance rendering callbacks across a declared window. A feedback loop can resend height without changing the iframe's final geometry.
- `image`: Read the rendered rectangle directly to avoid protocol quad subtraction.
- `halfDevicePixel`: Centring a ch-sized reading column produces fractional layout positions. Compare its breakout origin within half a physical pixel on every engine.

### packages/export-pipeline/tests/a11y/small-widths.spec.ts

- `textBreaks`: Copy longhands too: computed font shorthands can be empty when variants differ.
- `lines`: WebKit includes an empty rect on the next line at some word boundaries. Only rectangles containing rendered glyphs establish a word break.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `'leadership ${width}px ${theme} spacing=${spaced}'`: Gecko's rect serialization can return 43.999992 for a 44px layout box.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/write-distractors-print.spec.ts

- `settleAnnouncements`: Live regions clear synchronously and deliver on the next animation frame. Drain pending announcements for both activities before taking the print baseline.
- `snapshot`: Playwright's caret suppression leaves empty style attributes after a capture.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `test.beforeEach`: Media emulation belongs to the page and survives navigation between fixtures.
- `test.beforeAll`: Preparing a stage is fixture setup; the timed case exercises print only.
- `checkSeparators`: Preserve the actual U+202F code point; locator text matching normalizes whitespace.
- `prints visible work only, with no load/write/report/state change and restores screen/focus`: A forced screen media override also applies to printToPDF; use native print media.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/write-distractors.spec.ts

- `evidence`: This fixture has no frames. The single-page axe runner keeps all rules and avoids a temporary tab in WebKit.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

### packages/export-pipeline/tests/a11y/zoom-text-spacing.spec.ts

- `CDP_ZOOM_SKIP`: 200% browser zoom is emulated via `Emulation.setDeviceMetricsOverride` over the Chrome DevTools Protocol, which only Chromium exposes. This is a harness limit, not a WebKit or Firefox exemption -- 1.4.4 applies in every engine. The 1.4.12 text-spacing mode injects CSS and runs in all three, so WebKit and Firefox reflow is covered there; WebKit and Firefox zoom itself needs a manual check.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.
- `MODES`: Not a WebKit or Firefox reflow exemption -- 1.4.4 applies in every engine; neither exposes this zoom-emulation hook. Verify zoom reflow manually.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not independently verified.

Sources: the comments and corresponding implementations in the named files at Studio commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. Explicit spec sections, issue numbers, capture revisions and owner dates above retain the original evidence references.

## Consequences

Preserve these constraints when changing the named fixtures or measurements. Recheck a recorded platform limitation before replacing its harness path. Deferred coverage and size work remain separate changes; this record does not waive their checks.
