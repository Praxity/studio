import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import type { PopupPlacement } from "../../../../packages/editor-core/src/frame-bridge/geometry";
import { rawCss } from "../raw-css";
import { installHostileMarkup } from "./fixtures/hostile-course";

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let privatePages: Record<string, string> = {};
interface HostileU4Context {
	startJourney(kind: string): void;
	snapshot(): { bytes: string; draft: string | null; layers: string[] };
}
const hostileU4Snapshot = () => (window as unknown as { u4: HostileU4Context }).u4.snapshot();
test.beforeAll(async () => {
	const root = resolve(import.meta.dirname, "../../../..");
	if (process.env.PRAXITY_U4_PAGES)
		privatePages = JSON.parse(await readFile(process.env.PRAXITY_U4_PAGES, "utf8"));
	const tokens = await readFile(
		join(root, "packages/editor-core/src/styles/editor-tokens.css"),
		"utf8",
	);
	const result = await build({
		stdin: {
			contents: `
import { mountPageLens, buildFrameView, anchorPopup, createEscapeDispatcher } from './packages/editor-core/src/frame-bridge/index.ts';
import { sanitizeHtml } from './packages/shared-blocks/src/sanitize.ts';
import { createSession, dispatch } from './packages/editor-core/src/session/index.ts';
import { readLesson } from './packages/grammar/src/index.ts';
import { renderBlockHtml } from './packages/export-pipeline/src/render-block-html.ts';
import { createTranslator } from 'use-intl/core';
import en from './packages/editor-core/src/messages/en.json';
import fr from './packages/editor-core/src/messages/fr.json';
const doc = document.querySelector('iframe').contentDocument;
const dark = new URLSearchParams(location.search).get('theme') === 'dark';
const language = new URLSearchParams(location.search).get('lang') === 'fr' ? 'fr' : 'en';
doc.open(); doc.write('<!doctype html><html lang="en"><head><title>Course</title><style>body{margin:0;padding:48px 24px 24px 64px;background:'+(dark?'#171717':'#fbfbfb')+';color:'+(dark?'#f1f1f1':'#252525')+';font:20px/1.6 Georgia}main{max-width:720px;margin:auto}.praxity-block{margin-bottom:32px}p{margin:0 0 24px}.praxity-columns{display:flex;gap:64px}.praxity-column{min-width:0}h1{font:32px/1.2 Georgia}[hidden]{display:none!important}</style></head><body><main></main></body></html>'); doc.close();
doc.defaultView.history.replaceState(null,'','/course?praxity-inspect=1');
const text = window.fixtureSource ?? '# Geometry\\n\\n'+Array.from({length:18},(_,i)=>'Paragraph '+(i+1)+'. Good feedback describes what happened and what could change.\\n\\n').join('')+'::: columns\\n::\\n\\nFirst column.\\n\\n::\\n\\nSecond column.\\n:::\\n\\n::: cards {layout=slides}\\n:: A card\\nA card front.\\n::: back\\nA card back.\\n:::\\n:::\\n\\n::: cards {columns=2}\\n:: First\\nFirst card text.\\n\\n:: Second\\nSecond card text.\\n\\n:: Third\\nThird card text.\\n\\n:: Fourth\\nFourth card text.\\n:::\\n\\nLast paragraph.\\n';
const lesson = readLesson(text); if(lesson.hasErrors) throw Error(JSON.stringify(lesson.errors));
const pageId = lesson.pages[0].id;
doc.querySelector('main').innerHTML = lesson.pages[0].blocks.map(renderBlockHtml).join('');
let state = createSession({interfaceLanguage:language,courseLanguage:'en'});
const translate = createTranslator({locale:language,messages:language==='fr'?fr:en});
const view = () => buildFrameView({lesson,file:'lesson.prax',pageId,session:state,translate,alwaysShowHandles:true});
let lens; let popup; let sourceSeed; let savedBytes = 'Original body.\\n'; let effects = [];
const handle = nodeId => ({file:'lesson.prax',nodeId,role:'handle'});
const deps = {now:0,validateDraft:()=>({diagnostics:[],escapes:false}),helperTokens:()=>[],focusNeighbours:f=>({page:handle(pageId)}),nameOfFocus:()=> 'Paragraph',readDraft:()=>sourceSeed,translate:m=>translate(m.key,m.params)};
function send(command) {
 const result = dispatch(state,command,deps); state=result.state; effects.push(...result.effects);
 const modal=document.querySelector("dialog[data-fixture-dialog]"); if(modal && !state.layers.some(layer=>layer.kind==="dialog")) modal.close();
 if(lens) lens.render(view());
 for(const effect of result.effects) {
  if(effect.type==='focus') lens?.focus(effect.target);
  if(effect.type==='post' && effect.method==='operationApply') {
   savedBytes=effect.request.args.text;
   send({type:'operationReply',result:{ok:true,transactionId:effect.request.transactionId,files:[{path:'lesson.prax',fromRevision:'r0',toRevision:'r1',edits:[]}],intent:'edit',mapping:[],inverse:{files:[],mapping:[],guards:[]},summary:{key:'operation',params:{}},diagnostics:[],focus:handle(sourceSeed.target.nodeId)}});
  }
 }
 return result.consumed;
}
lens=mountPageLens({document:doc,view:view(),onEvent:event=>{if(event.event==='escape')send({type:'escape'});if(event.event==='focusChanged')send({type:'focusChanged',focus:event.focus});}});
const dispatcher=createEscapeDispatcher(send); dispatcher.attach(document);
window.u4={doc,lens,send,dispatcher,anchorPopup,sanitizeHtml,get state(){return state},get bytes(){return savedBytes},get effects(){return effects},
 openMenu(kind='menu',right=false){
  popup?.dispose(); doc.querySelectorAll('[data-fixture-menu]').forEach(e=>e.remove());
  const handles=[...doc.querySelectorAll('button[data-focus-role="handle"]')]; const target=handles.at(-1); target.nextElementSibling.scrollIntoView({block:'end'}); lens.refresh();
  const menu=doc.createElement('div');menu.dataset.fixtureMenu='';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Block actions');menu.style.width='280px';menu.innerHTML='<button role="menuitem" style="width:100%;height:30px">Back</button>'+Array.from({length:9},(_,i)=>'<button role="menuitem" style="width:100%;height:30px">Action '+i+'</button>').join('');target.after(menu);
  let placement;popup=anchorPopup({element:menu,anchor:()=>right?{left:doc.defaultView.innerWidth-50,right:doc.defaultView.innerWidth-20,top:160,bottom:190}:target.getBoundingClientRect(),hostWidth:()=>innerWidth,kind,admit:(e,kind)=>lens.registerChrome(e,kind),onPlacement:p=>placement=p});
  menu.querySelector('button').focus();return {placement,box:menu.getBoundingClientRect().toJSON(),hit:doc.elementFromPoint(menu.getBoundingClientRect().left+menu.offsetWidth/2,menu.getBoundingClientRect().top+menu.offsetHeight/2)?.closest('[data-fixture-menu]')===menu};
 },
 startJourney(kind){
  const nodeId=view().nodes.find(n=>n.kind==='block').id; const opener=handle(nodeId);sourceSeed={file:'lesson.prax',target:{kind:'node',nodeId,path:[0,0],fingerprint:'fp'},baseRevision:'r0',expectedText:'Original body.\\n',editableText:'Original body.\\n'};
  send({type:'select',focus:opener});send({type:'openSource',seed:sourceSeed});send({type:'changeDraft',text:'Typed body /\\n',selection:[12,12]});
  let popupOpener=kind==='actions'||kind==='insert'||kind==='drag'?opener:{...opener,role:'source',selection:[12,12]};
  const snapshot={target:{file:'lesson.prax',ref:sourceSeed.target,expectedText:sourceSeed.expectedText},revision:'r0',draftId:state.activeDraft};
  if(kind==='submenu'){send({type:'openPopup',popup:'actions',opener,target:snapshot});const parent=doc.createElement('button');parent.textContent='Parent';doc.querySelector('[data-node-id="'+nodeId+'"]').after(parent);popupOpener={...opener,role:'chip:parent'};lens.registerControl(parent,popupOpener);}
  if(kind==='dialog')send({type:'openDialog',dialog:'fixture',opener:popupOpener,target:snapshot});else send({type:'openPopup',popup:kind,opener:popupOpener,target:snapshot});
  lens.focus({...opener,role:'source',selection:[12,12]});return {popupOpener};
 },
 snapshot(){return {bytes:savedBytes,layers:state.layers.map(l=>l.kind),draft:state.activeDraft?state.drafts[state.activeDraft].text:null,focus:doc.activeElement?.getAttribute('data-focus-role')};}
};`,
			resolveDir: root,
			sourcefile: "u4-fixture.ts",
			loader: "ts",
		},
		bundle: true,
		nodePaths: [join(root, "apps/desktop/node_modules")],
		write: false,
		platform: "browser",
		format: "iife",
		plugins: [rawCss],
	});
	server = createServer((request, response) => {
		const source =
			privatePages[new URL(request.url ?? "/", baseUrl).searchParams.get("page") ?? ""];
		const fixtureSource = JSON.stringify(source ?? null).replaceAll("<", "\\u003c");
		response.setHeader(
			"Content-Type",
			request.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8",
		);
		if (request.url === "/fixture.js") response.end(result.outputFiles[0].text);
		else
			response.end(
				`<!doctype html><html lang="en"><head><title>U4 geometry</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}body{margin:0;padding:16px;background:var(--desk)}iframe{border:0;display:block;width:100%;height:calc(100vh - 32px);border-radius:10px;box-shadow:var(--shadow-2)}</style></head><body><iframe title="Course"></iframe><script>window.fixtureSource=${fixtureSource};document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')==='dark'?'light':'dark';</script><script src="/fixture.js"></script></body></html>`,
			);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No fixture port");
	baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
	if (!server) return;
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

test("hostile markup leaves the dirty U4 draft, layers and focus intact", async ({ page }) => {
	await page.goto(baseUrl);
	await page.waitForFunction(() => "u4" in window);
	const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
	if (!frame) throw new Error("Missing U4 course frame");
	const nodeId = await frame
		.locator('button[data-focus-role="handle"]')
		.first()
		.getAttribute("data-node-id");
	if (!nodeId) throw new Error("Missing U4 hostile-course node");
	const identity = {
		channel: "u4-direct",
		pageId: nodeId,
		nodeId,
		file: "lesson.prax",
		parentOrigin: baseUrl,
	};
	await installHostileMarkup(frame, identity);
	await page.evaluate(() =>
		(window as unknown as { u4: HostileU4Context }).u4.startJourney("helper"),
	);
	await expect(frame.getByRole("textbox", { name: /^Source of / })).toBeFocused();
	await page.keyboard.press("Escape");
	const after = await page.evaluate(hostileU4Snapshot);
	expect(after.layers.at(-1)).toBe("source");
	expect(after.bytes).toBe("Original body.\n");
	expect(after.draft).toBe("Typed body /\n");
});

test("F11 clips adjacent card paragraph handles at the bottom viewport edge", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 760 });
	await page.goto(baseUrl);
	await page.waitForFunction(() => Boolean((window as any).u4));
	await page.evaluate(() => {
		const { doc, lens } = (window as any).u4;
		const buttons = [...doc.querySelectorAll('button[data-focus-role="handle"]')];
		const first = buttons.find((button: any) =>
			button.getAttribute("aria-label")?.includes("First card text"),
		) as HTMLButtonElement;
		if (!first?.nextElementSibling) throw new Error("Missing first card paragraph");
		doc.defaultView.scrollBy(
			0,
			first.nextElementSibling.getBoundingClientRect().top - doc.defaultView.innerHeight + 6,
		);
		lens.refresh();
	});
	await expect
		.poll(() =>
			page.evaluate(() => {
				const { doc } = (window as any).u4;
				const buttons = [...doc.querySelectorAll('button[data-focus-role="handle"]')].filter(
					(button: any) =>
						/(?:First|Second) card text/u.test(button.getAttribute("aria-label") ?? ""),
				);
				return (
					buttons.length === 2 &&
					buttons.every((button: any) => {
						const box = button.getBoundingClientRect();
						return (
							box.top >= 0 &&
							box.bottom <= doc.defaultView.innerHeight &&
							doc
								.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
								?.closest("button") === button
						);
					})
				);
			}),
		)
		.toBe(true);
});

test("M2 native dialog cancellation goes through the controller once", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 760 });
	await page.goto(baseUrl);
	await page.waitForFunction(() => Boolean((window as any).u4));
	await page.evaluate(() => {
		(window as any).u4.startJourney("dialog");
		const dialog = document.createElement("dialog");
		dialog.dataset.praxityChrome = "dialog";
		dialog.dataset.fixtureDialog = "";
		dialog.setAttribute("aria-labelledby", "dialog-title");
		dialog.innerHTML =
			'<h2 id="dialog-title">Fixture dialog</h2><p>Dialog content</p><footer><button>Cancel</button></footer>';
		document.body.append(dialog);
		dialog.showModal();
	});
	const sheet = await page.locator("dialog").boundingBox();
	expect(sheet?.width).toBe(390);
	expect(sheet?.height).toBe(760);
	await page.keyboard.press("Escape");
	await expect(page.locator("dialog")).not.toBeVisible();
	const result = await page.evaluate(() => (window as any).u4.snapshot());
	expect(result.layers.at(-1)).toBe("source");
	expect(result.bytes).toBe("Original body.\n");
	await expect(
		page.frameLocator("iframe").getByRole("textbox", { name: /^Source of / }),
	).toBeFocused();
	await page.goto(baseUrl);
	await page.waitForFunction(() => Boolean((window as any).u4));
	await page.evaluate(() => {
		(window as any).u4.startJourney("dialog");
		const dialog = document.createElement("dialog");
		dialog.dataset.fixtureDialog = "";
		dialog.innerHTML = "<button>Cancel</button>";
		document.body.append(dialog);
		dialog.showModal();
		const event = new Event("cancel", { cancelable: true });
		dialog.dispatchEvent(event);
		if (event.defaultPrevented) throw new Error("Forged cancellation was consumed");
	});
	const cancelled = await page.evaluate(() => (window as any).u4.snapshot());
	expect(cancelled.layers.at(-1)).toBe("dialog");
	expect(cancelled.bytes).toBe("Original body.\n");
	await expect(page.locator("dialog")).toBeVisible();
	await expect(page.locator("dialog button")).toBeFocused();
});

// Private course evidence is opt-in; source bytes and captures stay outside Git.
if (process.env.PRAXITY_U4_PAGES)
	for (const pageNumber of [5, 17])
		for (const width of [1280, 390])
			for (const theme of ["light", "dark"]) {
				test(`F11 leadership page ${pageNumber} ${theme} ${width}`, async ({ page }, testInfo) => {
					await page.setViewportSize({ width, height: width === 390 ? 760 : 860 });
					await page.goto(`${baseUrl}/?page=${pageNumber}&theme=${theme}&lang=fr`);
					await page.waitForFunction(() => Boolean((window as any).u4));
					for (const index of [0, 0.5, 1]) {
						await page.evaluate((index) => {
							const { doc, lens } = (window as any).u4;
							const handles = [...doc.querySelectorAll('button[data-focus-role="handle"]')].filter(
								(button: any) => !button.hidden,
							);
							const target = handles[Math.round(index * (handles.length - 1))] as HTMLButtonElement;
							if (!target?.nextElementSibling) throw new Error("No course handle");
							target.nextElementSibling.scrollIntoView({ block: "center" });
							lens.refresh();
						}, index);
						await expect
							.poll(() =>
								page.evaluate(() => {
									const { doc } = (window as any).u4;
									const win = doc.defaultView;
									return [...doc.querySelectorAll('button[data-focus-role="handle"]')]
										.filter(
											(button: any) =>
												!button.hidden &&
												button.nextElementSibling.getBoundingClientRect().bottom > 12 &&
												button.nextElementSibling.getBoundingClientRect().top <
													win.innerHeight - 12,
										)
										.flatMap((button: any) => {
											const box = button.getBoundingClientRect();
											const clear =
												box.left >= 0 &&
												box.top >= 0 &&
												box.right <= win.innerWidth &&
												box.bottom <= win.innerHeight &&
												doc
													.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
													?.closest("button") === button;
											return clear
												? []
												: [
														{
															name: button.getAttribute("aria-label"),
															hitHandle: doc
																.elementFromPoint(
																	box.left + box.width / 2,
																	box.top + box.height / 2,
																)
																?.closest("button")?.outerHTML,
															near: [...doc.querySelectorAll('button[data-focus-role="handle"]')]
																.map((peer: any) => ({
																	name: peer.getAttribute("aria-label"),
																	box: peer.getBoundingClientRect().toJSON(),
																}))
																.filter((peer: any) => Math.abs(peer.box.top - box.top) < 24),
															box: box.toJSON(),
															hit: doc.elementFromPoint(
																box.left + box.width / 2,
																box.top + box.height / 2,
															)?.outerHTML,
														},
													];
										});
								}),
							)
							.toEqual([]);
					}
					const menu = await page.evaluate(() => (window as any).u4.openMenu());
					expect(menu.hit).toBe(true);
					const captures = process.env.PRAXITY_U4_SCREENSHOTS;
					if (captures)
						await page.screenshot({
							path: join(
								captures,
								`${testInfo.project.name}-leadership-${pageNumber}-${theme}-${width}.png`,
							),
						});
				});
			}

for (const theme of ["light", "dark"])
	for (const width of [1280, 390]) {
		test(`F11 tokens, scroll, top-layer menus ${theme} ${width}`, async ({ page }, testInfo) => {
			await page.setViewportSize({ width, height: width === 390 ? 760 : 860 });
			await page.goto(`${baseUrl}/?theme=${theme}`);
			await page.waitForFunction(() => Boolean((window as any).u4));
			for (const fraction of [0, 0.5, 1]) {
				await page.evaluate((fraction) => {
					const doc = (window as any).u4.doc;
					doc.defaultView.scrollTo(
						0,
						(doc.body.scrollHeight - doc.defaultView.innerHeight) * fraction,
					);
				}, fraction);
				await expect
					.poll(() =>
						page.evaluate(() => {
							const { doc } = (window as any).u4;
							const win = doc.defaultView;
							return [...doc.querySelectorAll('button[data-focus-role="handle"]')]
								.filter((button: any) => {
									const node = button.nextElementSibling.getBoundingClientRect();
									return node.bottom > 12 && node.top < win.innerHeight - 12;
								})
								.every((button: any) => {
									const box = button.getBoundingClientRect();
									return (
										box.left >= 0 &&
										box.top >= 0 &&
										box.right <= win.innerWidth &&
										box.bottom <= win.innerHeight &&
										doc
											.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
											?.closest("button") === button
									);
								});
						}),
					)
					.toBe(true);
			}
			await page.evaluate(() => {
				const { doc } = (window as any).u4;
				const columns = doc.querySelector(".praxity-columns");
				if (!columns) throw new Error("Missing columns");
				doc.defaultView.scrollBy(0, columns.getBoundingClientRect().top - 2);
			});
			await expect
				.poll(() =>
					page.evaluate(() => {
						const { doc } = (window as any).u4;
						const columns = doc.querySelector(".praxity-columns");
						const node = columns.closest("[data-block-id]") ?? columns.closest("[data-node-id]");
						const handle = doc.querySelector(
							`button[data-focus-role="handle"][data-node-id="${node.dataset.nodeId}"]`,
						);
						const box = handle.getBoundingClientRect();
						return box.top >= 0 && box.bottom <= doc.defaultView.innerHeight;
					}),
				)
				.toBe(true);
			const menu = await page.evaluate(() => (window as any).u4.openMenu());
			expect(menu.placement.side).toBe("above");
			expect(menu.box.width).toBe(width === 390 ? 346 : 280);
			expect(menu.box.left).toBeGreaterThanOrEqual(0);
			expect(menu.box.top).toBeGreaterThanOrEqual(0);
			expect(menu.box.right).toBeLessThanOrEqual(width - 32);
			expect(menu.box.bottom).toBeLessThanOrEqual((width === 390 ? 760 : 860) - 32);
			expect(menu.hit).toBe(true);
			// Handles share the top layer with L3 popups. Re-inserting a handle, as a patch
			// replacing its node does, closes it; the placement pass that re-shows it must
			// leave it beneath the open menu.
			const covered = await page.evaluate(() => {
				const { doc, lens } = (window as any).u4;
				const menu = doc.querySelector("[data-fixture-menu]");
				const box = menu.getBoundingClientRect();
				const centre = (button: any) => {
					const handle = button.getBoundingClientRect();
					return [handle.left + handle.width / 2, handle.top + handle.height / 2];
				};
				const beneath = [...doc.querySelectorAll('button[data-focus-role="handle"]')].filter(
					(button: any) => {
						const [x, y] = centre(button);
						return !button.hidden && x > box.left && x < box.right && y > box.top && y < box.bottom;
					},
				);
				for (const button of beneath) button.nextElementSibling.before(button);
				lens.refresh();
				return beneath.map((button: any) => {
					const [x, y] = centre(button);
					return doc.elementFromPoint(x, y)?.closest("[data-fixture-menu]") === menu;
				});
			});
			expect(covered.length).toBeGreaterThan(0);
			expect(covered.every(Boolean)).toBe(true);
			const captures = process.env.PRAXITY_U4_SCREENSHOTS;
			if (captures) {
				await mkdir(captures, { recursive: true });
				await page.screenshot({
					path: join(captures, `${testInfo.project.name}-${theme}-${width}-menu-up.png`),
				});
			}
			const submenu = await page.evaluate(() => (window as any).u4.openMenu("submenu", true));
			expect(submenu.placement.replaceParent).toBe(width === 390);
			if (width === 1280) expect(submenu.placement.side).toBe("left");
			expect(submenu.hit).toBe(true);
			if (captures)
				await page.screenshot({
					path: join(
						captures,
						`${testInfo.project.name}-${theme}-${width}-${width === 390 ? "menu-back" : "submenu-left"}.png`,
					),
				});
			const frame = page.frames()[1];
			expect((await new AxeBuilder({ page }).include("iframe").analyze()).violations).toEqual([]);
			const styles = await frame.evaluate(() => {
				const button = document.querySelector('button[data-focus-role="handle"]');
				if (!button) throw new Error("Missing handle");
				const style = getComputedStyle(button);
				return {
					paper: style.getPropertyValue("--paper").trim(),
					size: button.getBoundingClientRect().width,
					coursePaper: getComputedStyle(document.body).getPropertyValue("--paper"),
					focus: style.boxShadow,
				};
			});
			expect(styles.paper).toBe(theme === "dark" ? "#22272e" : "#fcfcfd");
			expect(styles.size).toBe(24);
			expect(styles.coursePaper).toBe("");
			await page.emulateMedia({ reducedMotion: "reduce" });
			expect(
				await frame.evaluate(() =>
					[
						...document.querySelectorAll(
							'[data-praxity-chrome="handle"],[data-praxity-chrome="popup"]',
						),
					].every((element) => getComputedStyle(element).transitionDuration === "0s"),
				),
			).toBe(true);
		});
	}

for (const kind of [
	"actions",
	"submenu",
	"insert-slash",
	"insert",
	"helper",
	"completion",
	"drag",
	"dialog",
]) {
	test(`M3 Escape returns focus and preserves draft for ${kind}`, async ({ page }) => {
		await page.goto(baseUrl);
		await page.waitForFunction(() => Boolean((window as any).u4));
		const { popupOpener } = await page.evaluate(
			(kind) => (window as any).u4.startJourney(kind),
			kind,
		);
		await page.keyboard.press("Escape");
		const snapshot = await page.evaluate(() => (window as any).u4.snapshot());
		expect(snapshot.bytes).toBe("Original body.\n");
		expect(snapshot.draft).toBe("Typed body /\n");
		if (popupOpener.role === "source")
			await expect(
				page.frameLocator("iframe").getByRole("textbox", { name: /^Source of / }),
			).toBeFocused();
		else expect(snapshot.focus).toBe(popupOpener.role);
		expect(snapshot.layers.at(-1)).toBe(kind === "submenu" ? "popup" : "source");
		if (kind === "submenu") await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		const committed = await page.evaluate(() => (window as any).u4.snapshot());
		expect(committed.bytes).toBe("Typed body /\n");
		expect(committed.focus).toBe("handle");
		expect(committed.layers.at(-1)).toBe("selected");
	});
}

test.describe("U4 review regressions", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(baseUrl);
		await page.waitForFunction(() => Boolean((window as any).u4));
	});
	test("course explicit and implicit live regions stay silent after learner updates", async ({
		page,
	}) => {
		await page.evaluate(() => {
			const u = (window as any).u4;
			const div = u.doc.createElement("div");
			div.id = "learner-live";
			div.innerHTML = u.sanitizeHtml(
				'<div role="log" aria-live="polite">Learner feedback</div><output>Score</output>' +
					["status", "alert", "marquee", "timer"]
						.map(
							(role) =>
								`<div role="${role}" aria-atomic="true" aria-relevant="all">${role} feedback</div>`,
						)
						.join("") +
					'<div aria-live="assertive">Explicit feedback</div>',
			);
			u.doc.body.append(div);
			u.lens.refresh();
		});
		const regions = page.frameLocator("iframe").locator("#learner-live > *");
		await expect(regions).toHaveCount(7);
		for (const region of await regions.all()) {
			await expect(region).toHaveAttribute("aria-live", "off");
			await expect(region).not.toHaveAttribute("aria-atomic");
			await expect(region).not.toHaveAttribute("aria-relevant");
		}
		await regions.first().evaluate((element) => element.setAttribute("aria-live", "polite"));
		await expect(regions.first()).toHaveAttribute("aria-live", "off");
	});
	test("centre anchor must remain uncovered on 320px host with tall popup", async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 760 });
		const result = await page.evaluate(() => {
			const u = (window as any).u4;
			const d = u.doc;
			const menu = d.createElement("div");
			menu.style.cssText = "width:280px;height:600px";
			menu.textContent = "Actions";
			d.body.append(menu);
			const anchor = { left: 80, right: 104, top: 350, bottom: 374 };
			let placement: PopupPlacement | null = null;
			u.anchorPopup({
				element: menu,
				anchor: () => anchor,
				hostWidth: () => innerWidth,
				kind: "menu",
				admit: (e: Element, kind: "popup" | "geometry") => u.lens.registerChrome(e, kind),
				onPlacement: (p: PopupPlacement) => (placement = p),
			});
			const b = menu.getBoundingClientRect();
			return {
				box: b.toJSON(),
				placement,
				overflow: d.defaultView.getComputedStyle(menu).overflowY,
				covered:
					b.left < anchor.right &&
					b.right > anchor.left &&
					b.top < anchor.bottom &&
					b.bottom > anchor.top,
			};
		});
		expect(result.covered).toBe(false);
		expect(result.placement).toMatchObject({ side: "below", maxHeight: 346 });
		expect(result.box.top).toBe(382);
		expect(result.box.bottom).toBeLessThanOrEqual(728);
		expect(result.overflow).toBe("auto");
	});
	test("popup follows translated anchor without unrelated scroll", async ({ page }) => {
		await page.evaluate(() => {
			const u = (window as any).u4;
			const d = u.doc;
			const a = d.createElement("button");
			a.id = "moving-anchor";
			a.style.cssText = "position:absolute;left:100px;top:100px;width:24px;height:24px";
			a.textContent = "A";
			d.body.append(a);
			u.lens.registerChrome(a);
			const menu = d.createElement("div");
			menu.id = "moving-menu";
			menu.style.cssText = "width:150px;height:80px";
			menu.textContent = "Popup";
			d.body.append(menu);
			u.anchorPopup({
				element: menu,
				anchor: () => a.getBoundingClientRect(),
				hostWidth: () => innerWidth,
				kind: "helper",
				admit: (e: Element, kind: "popup" | "geometry") => u.lens.registerChrome(e, kind),
			});
		});
		await page.waitForTimeout(200);
		await page.evaluate(() => {
			(window as any).u4.doc.querySelector("#moving-anchor").style.transform = "translateY(100px)";
		});
		await page.waitForTimeout(300);
		const result = await page.evaluate(() => {
			const d = (window as any).u4.doc;
			return {
				anchor: d.querySelector("#moving-anchor").getBoundingClientRect().toJSON(),
				menu: d.querySelector("#moving-menu").getBoundingClientRect().toJSON(),
			};
		});
		expect(result.menu.top).toBeCloseTo(result.anchor.bottom + 8, 0);
	});
	test("a capped popup preserves its anchor gap under CSS zoom", async ({ page }) => {
		const result = await page.evaluate(() => {
			const u = (window as any).u4;
			const doc = u.doc;
			const wrapper = doc.createElement("div");
			wrapper.style.zoom = "0.5";
			const menu = doc.createElement("div");
			menu.style.cssText = "width:280px;height:1800px";
			menu.textContent = "Tall menu";
			wrapper.append(menu);
			doc.body.append(wrapper);
			const anchor = { left: 80, right: 104, top: 500, bottom: 524 };
			u.anchorPopup({
				element: menu,
				anchor: () => anchor,
				hostWidth: () => innerWidth,
				kind: "menu",
				admit: (element: Element, kind: "popup" | "geometry") =>
					u.lens.registerChrome(element, kind),
			});
			return menu.getBoundingClientRect().toJSON();
		});
		expect(result.top).toBe(0);
		expect(result.bottom).toBe(492);
	});
	test("nested course data-chrome must not change chrome tokens after refresh", async ({
		page,
	}) => {
		const result = await page.evaluate(() => {
			const u = (window as any).u4;
			const d = u.doc;
			const handle = d.querySelector('button[data-focus-role="handle"]');
			const node = handle.nextElementSibling;
			const wrap = d.createElement("div");
			wrap.setAttribute("data-chrome", "dark");
			handle.before(wrap);
			wrap.append(handle, node);
			u.lens.refresh();
			const paper = d.defaultView.getComputedStyle(handle).getPropertyValue("--paper").trim();
			d.documentElement.setAttribute("data-chrome", "dark");
			return {
				root: d.documentElement.dataset.chrome,
				paper,
				authoredRootPaper: d.defaultView
					.getComputedStyle(handle)
					.getPropertyValue("--paper")
					.trim(),
				ink: d.defaultView.getComputedStyle(handle).getPropertyValue("--ink").trim(),
			};
		});
		expect(result.paper).toBe("#fcfcfd");
		expect(result.authoredRootPaper).toBe("#fcfcfd");
	});
	test("Chromium accessibility tree silences every course live role", async ({
		page,
		browserName,
	}, testInfo) => {
		test.skip(browserName !== "chromium");
		await page.evaluate(() => {
			const u = (window as any).u4;
			const div = u.doc.createElement("div");
			div.innerHTML = u.sanitizeHtml(
				["log", "status", "alert", "marquee", "timer"]
					.map((role) => `<div role="${role}">${role} feedback</div>`)
					.join("") + "<output>Score</output>",
			);
			u.doc.body.append(div);
			u.lens.refresh();
		});
		const cdp = await page.context().newCDPSession(page);
		const tree = await cdp.send("Page.getFrameTree");
		const frameId = tree.frameTree.childFrames?.[0].frame.id;
		if (!frameId) throw Error("No frame");
		const ax = await cdp.send("Accessibility.getFullAXTree", { frameId });
		await testInfo.attach("course-live-ax-tree", {
			body: JSON.stringify(ax, null, 2),
			contentType: "application/json",
		});
		expect(ax.nodes.some((n) => n.role?.value === "log")).toBe(true);
		expect(
			ax.nodes
				.flatMap((n) => n.properties ?? [])
				.filter((p) => p.name === "live" && ["polite", "assertive"].includes(p.value.value)),
		).toEqual([]);
	});
	for (const mode of ["rtl", "zoom", "scale", "scroll", "text200"])
		test(`popup matrix ${mode} at 320px`, async ({ page }) => {
			await page.setViewportSize({ width: 320, height: 760 });
			const result = await page.evaluate((mode) => {
				const u = (window as any).u4;
				const d = u.doc;
				const a = d.createElement("button");
				a.style.cssText = "position:absolute;left:90px;top:90px;width:24px;height:24px";
				a.textContent = "A";
				u.lens.registerChrome(a);
				const wrap = d.createElement("div");
				wrap.append(a);
				d.body.append(wrap);
				if (mode === "rtl") d.documentElement.dir = "rtl";
				if (mode === "zoom") wrap.style.zoom = "2";
				if (mode === "scale") wrap.style.transform = "translate(10px,8px) scale(1.2)";
				const menu = d.createElement("div");
				menu.style.width = "280px";
				if (mode === "text200") menu.style.fontSize = "26px";
				menu.innerHTML =
					'<button role="menuitem">Long action for a source block with a descriptive French title</button>'.repeat(
						8,
					);
				wrap.append(menu);
				let placement: PopupPlacement | null = null;
				const popup = u.anchorPopup({
					element: menu,
					anchor: () => a.getBoundingClientRect(),
					hostWidth: () => innerWidth,
					kind: "menu",
					admit: (e: Element, kind: "popup" | "geometry") => u.lens.registerChrome(e, kind),
					onPlacement: (p: PopupPlacement) => (placement = p),
				});
				if (mode === "scroll") {
					d.defaultView.scrollTo(0, 32);
					popup.refresh();
				}
				const b = menu.getBoundingClientRect();
				return {
					anchor: a.getBoundingClientRect().toJSON(),
					box: b.toJSON(),
					viewport: { width: d.defaultView.innerWidth, height: d.defaultView.innerHeight },
					placement,
				};
			}, mode);
			expect(result.box.left).toBeGreaterThanOrEqual(-0.5);
			expect(result.box.top).toBeGreaterThanOrEqual(-0.5);
			expect(result.box.right).toBeLessThanOrEqual(result.viewport.width + 0.5);
			expect(result.box.bottom).toBeLessThanOrEqual(result.viewport.height + 0.5);
		});
	test("Escape dispatcher removes top and frame listeners on dispose", async ({ page }) => {
		await page.evaluate(() => {
			const u = (window as any).u4;
			u.startJourney("helper");
			u.lens.dispose();
			u.dispatcher.dispose();
		});
		await page.keyboard.press("Escape");
		await page.evaluate(() => {
			const button = document.createElement("button");
			button.textContent = "Shell focus";
			document.body.append(button);
			button.focus();
		});
		await page.keyboard.press("Escape");
		const result = await page.evaluate(() => (window as any).u4.snapshot());
		expect(result.layers.at(-1)).toBe("popup");
	});
	test("200 percent text labels do not overlap following menu rows at 320px", async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 760 });
		await page.evaluate(() => (window as any).u4.openMenu());
		const result = await page.evaluate(() => {
			const u = (window as any).u4;
			const d = u.doc;
			const menu = d.querySelector("[data-fixture-menu]");
			menu.style.fontSize = "26px";
			const buttons = [...menu.querySelectorAll("button")];
			buttons.forEach((b) => b.style.removeProperty("height"));
			buttons[0].textContent = "Question à choix multiples";
			const range = d.createRange();
			range.selectNodeContents(buttons[0]);
			return {
				row: buttons[0].getBoundingClientRect().toJSON(),
				text: range.getBoundingClientRect().toJSON(),
				next: buttons[1].getBoundingClientRect().toJSON(),
			};
		});
		expect(result.text.bottom).toBeLessThanOrEqual(result.next.top);
		expect(result.row.height).toBeGreaterThanOrEqual(44);
	});
});
