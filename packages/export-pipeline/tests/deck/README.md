# Compiled module-deck journey

Run from the repository root:

```sh
pnpm --filter @praxity/export-pipeline prebuild:client
pnpm --filter @praxity/export-pipeline test:deck
```

Finish prebuild before starting browser workers. Source-mode compilation checks a shared viewer cache and replaces its files when stale. Keep package/source files unchanged during the run, and serialize other builds that refresh export assets. Leave `fullyParallel` disabled so each file builds its fixtures once per worker. CI engine and shard jobs use separate checkouts.

The fixture goes through `compileCourse()` and HTML deployment. It has one four-slide module and a second module, full script text longer than the summary, an attempt gate, a pass gate, tall reading content, a local image fixture and an optional question that does not gate the second module. Stable playback checks use locally generated 60-second silent WAV clips, longer than the 45-second journey timeout. The formatted transcript uses a 90-second clip so playback still outlasts the journey after seeking to its final 22-second cue. The separate `audio-short` variant retains the existing 2-second MP3 for real natural completion and source progression. The fixture server's `/stable/` prefix retains compiled WAV assets and substitutes long WAV bytes only for existing MP3 assets. Missing compiled assets still return 404. These clips use the real media decoder and clock. All engines run headless and muted, with Firefox's `media.default_volume` set to `0.0`. No production audio is generated. Each test starts with fresh browser storage.

Unavailable-media checks return HTTP 503 for MP3 and WAV from the fixture server. Metadata-loading checks hold actual audio responses under unique route prefixes, then release packaged bytes or return HTTP 503. Cleanup releases every gate in `finally`. Browser media requests can bypass `page.route()` in WebKit, so these outcomes must come from the server.

Checks run in Chromium, WebKit, and Firefox: script-only reading, gate release, failed final attempt, reload resume, module boundary, direct/history access, one active slide, natural audio progression to a question stop, keyboard focus, 320px reflow, axe, the controls skip link, per-slide visits no-JavaScript reading, Play/Pause state, keyboard seeking, shell transport visibility, native content sizing, independent scrolling, optional matching left/right sidebars, mutually exclusive panels, inspection without learner writes, one-slide small previews, reciprocal media pausing and visible playback failures. Narrow screenshots are saved in the Playwright results folder. These checks do not substitute for physical Safari, screen-reader or real LMS testing.

To save compiled fixtures for inspection, use one engine and one worker with a dedicated output directory:

```sh
DECK_ARTIFACT_DIR=/tmp/praxity-module-deck pnpm --filter @praxity/export-pipeline test:deck --project=chromium --workers=1
```

Do not share `DECK_ARTIFACT_DIR` across concurrent invocations or projects. To inspect the generated files with byte-range support for audio seeking, use the already-installed static server:

```sh
pnpm --filter @praxity/export-pipeline exec node --input-type=module -e 'import http from "node:http"; import handler from "serve-handler"; http.createServer((req,res)=>handler(req,res,{public:"/tmp/praxity-module-deck",cleanUrls:false})).listen(8768,"127.0.0.1")'
```

Open `http://127.0.0.1:8768/reading/index.html` or `/audio/index.html`. Studio save and preview integration is covered by headless browser authoring journeys in `apps/desktop/e2e/browser-editor/`. Visual acceptance and physical assistive-technology/LMS testing remain separate checks. Timestamps are used only internally; none are displayed in the transcript.
