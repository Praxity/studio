import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";

for (const locale of ["en", "fr"] as const)
	for (const actor of [true, false]) {
		test(`xAPI ${locale} actor=${actor} keeps reporting and private notices truthful`, async ({
			browser,
		}) => {
			const folder = await mkdtemp(join(tmpdir(), "review-s14b-xapi-"));
			const server = createServer(async (req, res) => {
				try {
					const path = new URL(req.url ?? "/", "http://localhost").pathname;
					res.setHeader(
						"Content-Type",
						path.endsWith(".js")
							? "text/javascript"
							: path.endsWith(".css")
								? "text/css"
								: "text/html; charset=utf-8",
					);
					res.end(await readFile(join(folder, path)));
				} catch {
					res.writeHead(404).end();
				}
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const address = server.address();
			if (!address || typeof address === "string") throw Error("No fixture address");
			try {
				{
					const read = readLesson(
						`---\nlang: ${locale}\n---\n# Practice\n::: self-check A {private=false}\nmodel: M\n:: L\nmissed: H\n:::\n\n::: self-check Private {private=true}\nmodel: M\n:: L\nmissed: H\n:::\n`,
					);
					const artifact = await compileCourse({
						id: `review-xapi-${locale}`,
						title: "Practice",
						sourceLocale: locale,
						content: read.pages,
						selfCheckContents: read.blocks
							.filter((b) => b.type === "selfCheck")
							.map((b) => selfCheckContentInput(b.id, readSelfCheckContent(read, b.id))),
					});
					try {
						const deployed = await deployCourse(artifact, {
							format: "xapi",
							xapiConfig: {
								endpoint: "https://lrs.example/statements",
								auth: "Basic review-fixture",
								actorMode: "lms",
							},
						});
						new AdmZip(deployed.zip).extractAllTo(join(folder, locale));
						{
							const context = await browser.newContext();
							const page = await context.newPage();
							const requests: string[] = [];
							await page.route("https://lrs.example/**", async (route) => {
								requests.push(route.request().postData() ?? "");
								await route.fulfill({ status: 200, body: "[]" });
							});
							try {
								const query = actor
									? "?actor=" +
										encodeURIComponent(
											JSON.stringify({ name: "Learner", mbox: "mailto:learner@example.com" }),
										)
									: "";
								await page.goto(
									`http://127.0.0.1:${address.port}/${locale}/${artifact.manifest.pages[0].slug}.html${query}`,
								);
								const root = page.locator("[data-self-check]").first();
								// Exercise reporting after controls mount and the host finishes restoring state.
								await expect(root.locator("[data-self-check-comparison]")).toHaveCount(1);
								await expect(page.locator("html")).not.toHaveAttribute(
									"data-praxity-learner-state",
									"pending",
								);
								await root.locator("textarea").fill("Answer");
								await root.locator('[data-self-check-action="check"]').click();
								await root.getByRole("checkbox").check();
								await root.locator('[data-self-check-action="show-feedback"]').click();
								await expect(root.locator("[data-self-check-comparison]")).not.toBeEmpty();
								const notice = await root.locator("[data-self-check-mode]").innerText();
								const save = await root.locator("[data-self-check-save]").innerText();
								await expect(root.locator("textarea")).toHaveAccessibleDescription(
									actor
										? locale === "en"
											? "Your answer is reported to the LMS. Drafts and comparison state may also be saved there. Your answer and comparison are saved in this browser on this device."
											: "Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés. Votre réponse et la comparaison sont enregistrées dans ce navigateur sur cet appareil."
										: locale === "en"
											? "Your answer stays in this browser on this device. It is not sent to the LMS. Your answer is not saved on this device. Keep a copy before leaving this page."
											: "Votre réponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS. Votre réponse n'est pas enregistrée sur cet appareil. Gardez-en une copie avant de quitter cette page.",
								);
								expect(notice).toBe(
									actor
										? locale === "en"
											? "Your answer is reported to the LMS. Drafts and comparison state may also be saved there."
											: "Votre r\u00e9ponse est transmise au LMS. Les brouillons et l'\u00e9tat de la comparaison peuvent aussi y \u00eatre enregistr\u00e9s."
										: locale === "en"
											? "Your answer stays in this browser on this device. It is not sent to the LMS."
											: "Votre r\u00e9ponse reste dans ce navigateur sur cet appareil. Elle n'est pas envoy\u00e9e au LMS.",
								);
								expect(save).toBe(
									actor
										? locale === "en"
											? "Your answer and comparison are saved in this browser on this device."
											: "Votre r\u00e9ponse et la comparaison sont enregistr\u00e9es dans ce navigateur sur cet appareil."
										: locale === "en"
											? "Your answer is not saved on this device. Keep a copy before leaving this page."
											: "Votre r\u00e9ponse n'est pas enregistr\u00e9e sur cet appareil. Gardez-en une copie avant de quitter cette page.",
								);
								if (actor)
									await expect
										.poll(() => requests.filter((s) => s.includes("Answer")).length)
										.toBeGreaterThan(0);
								else {
									expect(requests).toHaveLength(0);
								}
								const privateRoot = page.locator("[data-self-check]").nth(1);
								await privateRoot.locator("textarea").fill("Private answer");
								await privateRoot.locator('[data-self-check-action="check"]').click();
								await privateRoot.getByRole("checkbox").check();
								await privateRoot.locator('[data-self-check-action="show-feedback"]').click();
								const privateNotice = await privateRoot
									.locator("[data-self-check-mode]")
									.innerText();
								expect(privateNotice).toBe(
									locale === "en"
										? "Your answer is saved in this browser on this device. It is not sent to the LMS."
										: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
								);
								expect(requests.filter((s) => s.includes("Private answer"))).toHaveLength(0);
							} finally {
								await context.close();
							}
						}
					} finally {
						await artifact.dispose();
					}
				}
			} finally {
				await new Promise<void>((resolve, reject) =>
					server.close((e) => (e ? reject(e) : resolve())),
				);
				await rm(folder, { recursive: true });
			}
		});
	}
