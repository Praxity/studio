import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { expect } from "@playwright/test";
import type { DesignVariants } from "@praxity/grammar";
import type { ReviewAnchor } from "@praxity/review-share/review";
import { build } from "esbuild";
import { resolveDesignTokens } from "../../../../packages/shared-blocks/src/themes/resolve-design-tokens";
import type {
	CanvasPreviewDescriptor,
	HostedCourseDeployment,
} from "../../src/main/course-preview-service";
import { startStudioReadOnlyServer } from "../../src/main/studio/read-only-server";
import { openReviewStore } from "../../src/main/studio/review-store";

// The C5 captured-deployment fixture exercises actual bootstrap, assets and comments routes.
export async function servedReview(locale: string, deck = false) {
	const root = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "review-anchors-"),
	);
	const assetsDir = join(root, "assets");
	await mkdir(assetsDir);
	await writeFile(join(root, "lesson.prax"), "# Anchor review\n\nReview text.\n");
	for (const name of ["review-comments.js", "review-comments.css"])
		await cp(
			resolve(import.meta.dirname, `../../../../packages/export-pipeline/template/${name}`),
			join(assetsDir, name),
		);
	const theme = (mode: "light" | "dark") =>
		Object.entries(resolveDesignTokens({} as DesignVariants, mode))
			.map(([key, value]) => `${key}:${value}`)
			.join(";");
	const deckStyles = deck
		? await readFile(
				resolve(
					import.meta.dirname,
					"../../../../packages/shared-blocks/src/viewer/deck-shell.css",
				),
				"utf8",
			)
		: "";
	const utilities = deck
		? (
				await build({
					stdin: {
						contents: `import { enhanceDisclosure } from "./packages/export-pipeline/template/src/disclosure.ts";
			const more = document.querySelector('#deck-more');
			const trigger = more.querySelector('#deck-more-toggle');
			const disclosure = enhanceDisclosure(trigger, more.querySelector('#deck-more-panel'));
			const dismiss = target => { if (target instanceof Node && !more.contains(target)) disclosure.setExpanded(false); };
			document.addEventListener('pointerdown', event => dismiss(event.target));
			more.addEventListener('focusout', event => { if (!(event.relatedTarget instanceof Node && event.relatedTarget.contains(more))) dismiss(event.relatedTarget); });
			more.addEventListener('keydown', event => { if (event.key === 'Escape') { disclosure.setExpanded(false); trigger.focus(); } });`,
						resolveDir: resolve(import.meta.dirname, "../../../.."),
						loader: "ts",
					},
					bundle: true,
					write: false,
					format: "iife",
					platform: "browser",
				})
			).outputFiles[0].text
		: "";
	const captured = `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
		:root{${theme("light")}} html[data-praxity-mode="dark"]{${theme("dark")}} @media(prefers-color-scheme:dark){html:not([data-praxity-mode]){${theme("dark")}}}
		${deckStyles}
		body{margin:0;background:var(--praxity-color-background);color:var(--praxity-color-text);font:18px/1.6 system-ui}
		main{max-width:700px;padding:32px;margin:0 auto} h1{font-size:28px} p{margin-block:24px}
		a{color:var(--praxity-color-link)} .pin-target{display:inline-block} .spacer{height:1000px}
		.praxity-deck{--page-gutter:24px;--measure:700px;--space-12:32px;--type-body:18px;--deck-footer-height:56px;--paper:var(--praxity-color-background)}
		.deck-header{display:flex;align-items:center;justify-content:space-between;padding-inline:24px;min-height:56px;border-bottom:1px solid var(--praxity-color-border)}
		.praxity-deck #main-content{box-sizing:border-box;overflow:auto;margin:0}.deck-controls{min-height:56px}.deck-controls button{min-width:44px;min-height:44px}
		</style></head><body>${deck ? '<div class="praxity-deck" data-ready="true"><header class="deck-header">Lesson deck<div id="deck-more"><button id="deck-more-toggle" aria-expanded="false">More</button><div id="deck-more-panel"><div class="deck-utility-items"></div></div></div></header><div class="deck-workspace">' : ""}<main${deck ? ' id="main-content"' : ""}>${deck ? '<section class="deck-slide" data-deck-slide="page">' : ""}<h1>${locale === "fr" ? "Révision de la leçon" : "Lesson review"}</h1>
		<p data-node-id="quote" data-block-id="b-quote">${locale === "fr" ? "Un passage à relire attentivement." : "A passage to read carefully."}</p>
		<p data-node-id="pin" data-block-id="b-pin"><a class="pin-target" href="#destination">${locale === "fr" ? "Le repère reste sur ce lien." : "The pin stays on this link."}</a></p>
		<p data-node-id="changed" data-block-id="b-changed">${locale === "fr" ? "Le texte de ce bloc a été modifié." : "This block’s text has changed."}</p>
		<div class="spacer"></div><p id="destination">End</p>${deck ? "</section>" : ""}</main>${deck ? '</div><nav class="deck-controls"><button>Previous</button><span>1 / 1</span><button>Next</button></nav></div><script src="review-utilities.js"></script>' : ""}</body></html>`;
	const store = await openReviewStore(root);
	let head: CanvasPreviewDescriptor | undefined;
	const server = await startStudioReadOnlyServer({
		projectDir: root,
		getEditorOrigin: () => "http://127.0.0.1:9000",
		getCanvasHead: () => head,
		review: { store, capability: "A".repeat(43), assetsDir },
	});
	const deployment: HostedCourseDeployment = {
		format: "standalone",
		courseToken: "a".repeat(32),
		sourceRevisions: { "lesson.prax": "source" },
		manifest: {
			version: 1,
			rendererContractVersion: 1,
			learnerStateSchemaVersion: 1,
			courseId: "course",
			revision: "1".repeat(64),
			entry: "index.html",
			pageCount: 1,
			pages: [
				{
					id: "page",
					title: "Review fixture",
					lessonId: "lesson",
					slug: "index",
					runtime: { mode: "islands", islands: [], legacyReasons: [] },
					statefulBlockIds: [],
				},
			],
			files: [
				{
					path: "index.html",
					byteLength: Buffer.byteLength(captured),
					sha256: "b".repeat(64),
					mediaType: "text/html; charset=utf-8",
				},
				...(deck
					? [
							{
								path: "review-utilities.js",
								byteLength: Buffer.byteLength(utilities),
								sha256: "c".repeat(64),
								mediaType: "text/javascript; charset=utf-8",
							},
						]
					: []),
			],
		},
		openFile: async (path) =>
			Readable.from([Buffer.from(path === "review-utilities.js" ? utilities : captured)]),
		dispose: async () => {},
	};
	const hosted = await server.hostCourseArtifact(deployment);
	head = {
		entryUrl: hosted.entryUrl,
		courseId: "course",
		coreRevision: deployment.manifest.revision,
		responseRevision: deployment.manifest.revision,
		pages: [{ id: "page", slug: "index" }],
	};
	return {
		url: `${server.origin}/canvas${new URL(hosted.entryUrl).pathname}`,
		list: async () => {
			const reopened = await openReviewStore(root);
			return reopened.list(await reopened.principalFor("reviewer", "local-cli"));
		},
		seed: async (anchor: ReviewAnchor, body: string) => {
			const result = await store.create(await store.principalFor("reviewer", "local-preview"), {
				reviewId: store.reviewId,
				requestId: randomUUID(),
				anchor,
				body,
			});
			expect(result.ok).toBe(true);
		},
		close: async () => {
			await server.close();
			await rm(root, { recursive: true });
		},
	};
}
