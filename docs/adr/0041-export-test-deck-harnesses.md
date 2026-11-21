# 0041: Export test deck harnesses

## Status

Accepted. Records existing test constraints; no executable change.

## Context

Export tests include platform observations, fixture admission rules and measured allowances that are not apparent from their assertions. The records below preserve that context when code comments are removed. Platform observations describe the harness versions recorded by the tests; they are not new compatibility claims.

## Decision

### packages/export-pipeline/tests/deck/back-reload.spec.ts

- `Next, reload, Back returns to page one without a resume cue`: Gecko's automation reload navigates history-replaced URLs through about:blank.
- `a fresh tab resumes the saved second page`: This fixture's LMS saves on Commit, so finish the document exit before closing its tab.

### packages/export-pipeline/tests/deck/block-rendering.spec.ts

- `groupIndex`: Stored group instructions form one narration segment with its title. G4 has no instructions part, so project the converted prose into that model field.
- `layout`: An authored hyphen is an allowed break in Passif-agressif.
- `rects`: WebKit includes a zero-width caret at an authored hyphen break.
- `'categorize keeps statements readable, answers reachable and row radio navigation at ${width}'`: Gecko serializes attr() rather than the resolved generated text.
- `'flip cards retain visible focus, prompt and localized answer controls in ${locale} ${mode}'`: WebKit scrolls the focused card flush with the scrollport's edge.

### packages/export-pipeline/tests/deck/choice-state.spec.ts

- `'${locale} ${variant} ${presentation} ${theme} recovery retains history through draft reload'`: Browser zoom reduces the CSS viewport. CSS `zoom` on the root does not model this consistently for WebKit's fixed deck shell.
- `'${locale} ${variant} ${presentation} ${theme} recovery retains history through draft reload'`: Deck resize observers can move its scrolling pane after the viewport changes. Wait for a fully visible, uncovered action after native scroll.

### packages/export-pipeline/tests/deck/corner-artwork.spec.ts

- `WINDOWS_WEBKIT_LINK_TRAVERSAL_WIDTHS`: Windows WebKit exclusions: native artwork-link Tab traversal at these widths.
- `'artwork respects the ${width}px canvas and ordinary sibling slides'`: Match the existing macOS WebKit keyboard policy: Option+Tab includes links.

### packages/export-pipeline/tests/deck/frame-regressions.spec.ts

- `height`: Firefox's protocol quads round fractional origins; DOMRect preserves the target height.

### packages/export-pipeline/tests/deck/highlight-acceptance.spec.ts

- `offlineFile`: WebKit offline emulation rejects even plain file: pages. Deny every HTTP(S) request at the network seam; the other engines also expose offline state.
- `test.beforeAll`: The shared CLI/export acceptance fixture has a 120-second setup deadline; individual test deadlines remain unchanged. The original timeout evidence points to `docs/context/testing-strategy.md`.
- `canonicalHashes`: Firefox does not expose/intercept file: requests. Preserve the real package bytes in a second directory, omitting only the two unavailable adapters.
- `test.afterAll`: The shared CLI/export acceptance fixture has a 120-second setup deadline; individual test deadlines remain unchanged. The original timeout evidence points to `docs/context/testing-strategy.md`.
- `zoom`: A 1280 × 900 display at 400% has a 320 × 225 CSS-pixel viewport.

### packages/export-pipeline/tests/deck/mixed-order.spec.ts

- `'${source} ordered HTML deck shows module completion with a stored bookmark'`: Gecko's automation reload treats history-replaced URLs as navigation. Use the same native reload as the standalone resume journeys.

### packages/export-pipeline/tests/deck/module-deck.spec.ts

- `WINDOWS_WEBKIT_EXCLUSIONS`: Windows WebKit exclusions: formatted transcript's exact paused-media seek.
- `stablePlaybackAudio`: Stable-playback journeys use a separate server prefix. WebKit's media loader can bypass page.route, so serve real long bytes at the fixture server itself.
- `test.beforeEach`: Preserve the real media clock while keeping browser checks quiet on shared hosts.
- `stableAudio`: Outlast the 45s journey timeout. Formatted playback can also seek to the final cue at 22s, so its clock needs more time after that seek.
- `scriptUrls`: Count only course scripts. Playwright's injected scripts add their own window listeners for hit-target checks.
- `mouseButtonEvents`: Chromium's mouse-button event list; any of these makes an element clickable.
- `failedMedia`: WebKit media fetches also bypass page response events. Check the actual server endpoint, then retain the learner's playback and reading assertions.
- `'resume following restores transcript tracking without starting paused audio at ${width}px'`: Observe application seeks directly: WebKit can settle its initial media clock after pause, and this fixture server does not serve byte ranges.
- `visible`: Closed native details can retain descendant rectangles without painting them.
- `'Guided chrome keeps one icon-button treatment and one options disclosure at ${width}px, ${locale}, larger=${larger}'`: Focus moving out of More closes it, so clear focus rings by blurring instead.

### packages/export-pipeline/tests/deck/narration-regressions.spec.ts

- `test.beforeAll`: WebKit's media loader can bypass browser routing. Hold and fail the actual HTTP response so metadata and playback observe the same outcome.

### packages/export-pipeline/tests/deck/playwright.config.ts

- `defineConfig`: Only Chromium accepts --mute-audio; Linux WebKit refuses to launch with it.
- `defineConfig`: Gecko must advance its real media clock without opening an audio device.

### packages/export-pipeline/tests/deck/resume-orientation.spec.ts

- `fittingWord`: Sans is narrower than the former Book default. Keep the fixture's combined heading wider than a phone line while this individual word still fits whole.
- `lmsHtml`: A local same-origin LMS keeps the SCO's CMI data over iframe unload and relaunch. Entry is supplied for each new session, while Commit persists location, exit and suspend data.
- `standard`: The standard theme's display face and h1 size leave "composition" wider than a 320px line.
- `checkCuePresentation`: A top-layer cue cannot scroll the LMS's outer document; align its frame first.
- `cueScript`: Firefox does not report local script loads through Playwright's request events. Verify the loaded classic entry and its resulting focus instead.
- `measure`: Unwrapped widths are the words' natural widths. A drawn hyphen makes the wrapped fragments wider than that; an unmarked break does not.
- `'${mode} standalone ${transport} reload keeps page 3 without a resume cue or live write'`: Gecko's automation reload classifies history-replaced URLs as navigation. Exercise the native document reload used by learners instead.

### packages/export-pipeline/tests/deck/review-navigation.spec.ts

- `'transcript and comments leave navigation exposed at ${width}x${height}'`: toBeVisible alone does not detect another panel intercepting the button.

### packages/export-pipeline/tests/deck/self-check-effects.spec.ts

- `'initial closure ${format} equals every fresh self-check request'`: Gecko can omit a cached file request from its protocol events; DOM load still records it.

### packages/export-pipeline/tests/deck/self-check-loading.spec.ts

- `'round 7 ${format} print ${transition} preserves ${focus} on the owning activity'`: Firefox refuses focus changes in print media; choose focus before afterprint on screen.

### packages/export-pipeline/tests/deck/self-check-release.spec.ts

- `'${locale} ${format}: keyboard write, compare, edit, restore, print and reset'`: Scan last: axe's helper document disturbs Gecko's frame focus.

### packages/export-pipeline/tests/deck/standalone-arrival.spec.ts

- `browser`: Chromium's full headless browser supports BFCache; headless-shell does not.
- `test.use`: Permit native BFCache; the disabled variant installs an unload listener.
- `Back and Forward preserve the chosen pages and history`: A BFCache restore commits without another document load event.
- `'standalone native new-tab ${selection} First keeps the native destination'`: Desktop WebKit needs its native new-tab modifier on macOS and Windows.
- `popup`: Browser menus are outside Playwright's DOM. Follow the same native href the menu uses, without firing click or auxclick on the original link.

### packages/export-pipeline/tests/deck/write-distractors-acceptance.spec.ts

- `test.beforeAll`: Shared cold CLI/package/PDF build; individual cases retain 45s.
- `started`: The cold CLI/package/PDF fixture has a 120-second setup deadline; individual cases retain 45 seconds. The original timeout evidence points to `docs/context/testing-strategy.md`.
- `typstExecutablePath`: Scratch export assets have no adjacent compiler. Use the app's pinned native tools.

### packages/export-pipeline/tests/deck/write-distractors-narration.spec.ts

- `test.beforeEach`: As in card-narration.spec.ts, drive media events without a decoder clock.
- `test.beforeEach`: Native seeking can stay at zero without playback; control the clock too.
- `cue reveal and clip end never Check, rate, Compare or write`: Exercise the player's end handlers even when native playback cannot advance.

Sources: the comments and corresponding implementations in the named files at Studio commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. Explicit spec sections, issue numbers, capture revisions and owner dates above retain the original evidence references.

## Consequences

Preserve these constraints when changing the named fixtures or measurements. Recheck a recorded platform limitation before replacing its harness path. Deferred coverage and size work remain separate changes; this record does not waive their checks.
