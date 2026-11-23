import { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { projectLockCacheDirectory } from "../path-security";
import { createStudioProjectSession } from "../studio/project-session";
import { type StudioServer, startStudioServer } from "../studio/server";
import { retainedSession } from "./fixtures/studio-session";

const faults = vi.hoisted(() => ({ cleanup: false, renameBusy: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (faults.cleanup && String(args[0]).endsWith(".praxity-transaction.json")) {
				faults.cleanup = false;
				throw new Error("Stage cleanup denied");
			}
			if (faults.renameBusy && String(args[0]).endsWith("second.prax"))
				throw Object.assign(new Error("Sharing refusal"), { code: "EPERM" });
			return fs.rename(...args);
		},
	};
});

const scratch = process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir();
const roots: string[] = [];
const servers: StudioServer[] = [];
const children: ChildProcess[] = [];
const retained = new Map<StudioServer, Awaited<ReturnType<typeof retainedSession>>>();
const source = "---\ntitle: Same lesson\n---\n\n# Hello\n";

async function fixture(manifest = "title: Test\nlessons: [second.prax, first.prax]\n") {
	const root = await mkdtemp(join(scratch, "studio-server-"));
	roots.push(root);
	const projectDir = join(root, "project");
	await mkdir(projectDir);

	await writeFile(join(projectDir, "first.prax"), source);
	await writeFile(join(projectDir, "second.prax"), source);
	if (manifest) await writeFile(join(projectDir, "course.yaml"), manifest);
	return { root, projectDir };
}

it("starts Read preview without an editor payload", async () => {
	const files = await fixture();
	const server = await startStudioServer({ ...files, appVersion: "0.3.0" });
	servers.push(server);
	const response = await fetch(server.origin, { redirect: "manual" });
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toContain("canvas=read");
});

async function running(preview = false) {
	const files = await fixture();
	await persistFixtureIdentity(files.projectDir);
	const server = await startStudioServer({
		...files,
		appVersion: "0.3.0",
		...(preview
			? {
					exportAssetsDir: fileURLToPath(
						new URL("../../../resources/export-assets/", import.meta.url),
					),
				}
			: {}),
	});
	servers.push(server);
	const token = "a".repeat(43);
	retained.set(
		server,
		await retainedSession(files.projectDir, {
			editorOrigin: server.origin,
			...(preview
				? {
						exportAssetsDir: fileURLToPath(
							new URL("../../../resources/export-assets/", import.meta.url),
						),
					}
				: {}),
		}),
	);
	return { ...files, server, token };
}

function probe(
	server: StudioServer,
	path: string,
	options: {
		method?: string;
		headers?: Record<string, string> | string[];
		body?: string | Buffer;
		chunks?: string[];
	} = {},
): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			`${server.origin}${path}`,
			{ method: options.method ?? "GET", headers: options.headers },
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					text += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
			},
		);
		req.on("error", reject);
		if (options.chunks) for (const chunk of options.chunks) req.write(chunk);
		req.end(options.body);
	});
}

function rpc(
	server: StudioServer,
	token: string,
	method: string,
	args: unknown,
	headers: Record<string, string> = {},
) {
	return probe(server, "/api/rpc", {
		method: "POST",
		headers: {
			Origin: server.origin,
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify({ method, args }),
	});
}

async function testSession(server: StudioServer) {
	let fixture = retained.get(server);
	if (!fixture) {
		const { projectDir } = JSON.parse((await probe(server, "/api/identity")).text);
		fixture = await retainedSession(projectDir, {
			editorOrigin: server.origin,
			appVersion: "test",
		});
		retained.set(server, fixture);
	}
	return fixture;
}
async function service(server: StudioServer, _token: string, method: string, args: unknown) {
	const response = await (await testSession(server)).invoke(method, args);
	return { status: response.status, text: JSON.stringify(response) };
}
async function retainedSnapshot(server: StudioServer) {
	return {
		status: 200,
		text: JSON.stringify({ result: await (await testSession(server)).session.readSnapshot() }),
	};
}

afterEach(async () => {
	faults.renameBusy = false;
	faults.cleanup = false;
	await Promise.all(
		children.splice(0).map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}),
	);
	await Promise.all([...retained.values()].map((fixture) => fixture.close()));
	retained.clear();
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Studio launch HTTP boundary and retained project session", () => {
	it("root launches Read mode without forwarding the session fragment or serving the retired shell", async () => {
		const { server, token } = await running();
		const response = await probe(server, "/");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/launch?canvas=read#");
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.headers["referrer-policy"]).toBe("no-referrer");
		expect(response.text).toBe("");
		expect(JSON.stringify(response)).not.toContain(token);
		for (const route of ["/index.html", "/app.js", "/canvas.js"])
			expect((await probe(server, route)).status).toBe(404);
		for (const route of ["/index.html", "/?locale=fr", "/?app", "/assets/index.js", "/share"]) {
			const navigation = await probe(server, route, {
				headers: { "Sec-Fetch-Dest": "document" },
			});
			expect(navigation.status).toBe(303);
			expect(navigation.headers.location).toBe("/#");
			expect(navigation.text).toBe("");
			expect(JSON.stringify(navigation)).not.toContain(token);
		}
		expect(
			(await probe(server, "/launch?canvas=read", { headers: { "Sec-Fetch-Site": "cross-site" } }))
				.status,
		).toBe(403);
		const launch = await probe(server, "/launch?canvas=read");
		expect(launch.status).toBe(303);
		expect(launch.headers.location).toMatch(/^\/canvas\?admission=[A-Za-z0-9_-]{43}$/);
		expect(
			(
				await probe(server, String(launch.headers.location), {
					headers: { "Sec-Fetch-Site": "cross-site" },
				})
			).status,
		).toBe(403);
	});
	it("Read compilation uses an empty fragment before leaving the launch origin", async () => {
		const { server, token } = await running(true);
		const launch = await probe(server, "/launch?canvas=read");
		const built = await probe(server, String(launch.headers.location));
		expect(built.status).toBe(303);
		expect(String(built.headers.location)).toMatch(/\?praxity-resume=0#$/);
		expect(String(built.headers.location)).not.toContain(token);
	});
	it("refuses captured author documents and sends old encoded launches to Read", async () => {
		const { server, token } = await running(true);
		const launch = await probe(server, "/launch?canvas=read");
		const built = await probe(server, String(launch.headers.location));
		expect(built.status).toBe(303);
		const read = new URL(String(built.headers.location));
		expect(read.origin).not.toBe(server.origin);
		expect(read.pathname).toMatch(/^\/canvas\/preview\/.+\.html$/);
		expect((await fetch(read)).status).toBe(200);
		const headers = {
			Authorization: `Bearer ${token}`,
			"Sec-Fetch-Site": "same-origin",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Dest": "document",
		};
		for (const method of ["GET", "HEAD"]) {
			const author = await probe(server, read.pathname, { method, headers });
			expect(author.status).toBe(404);
		}
		const captured = read.pathname.slice("/canvas".length);
		const oldLaunch = await probe(server, `/launch?canvas=${encodeURIComponent(captured)}`, {
			headers,
		});
		expect(oldLaunch.status).toBe(303);
		const destination = new URL(String(oldLaunch.headers.location));
		expect(destination.origin).toBe(read.origin);
		expect(destination.pathname).toBe(read.pathname);
		expect(destination.hash).toBe("");
	});
	it("admits same-site documents and refuses same-site fetches at launch and admission", async () => {
		const { server } = await running(true);
		const documentHeaders = {
			"Sec-Fetch-Site": "same-site",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Dest": "document",
		};
		const launch = await probe(server, "/launch?canvas=read", { headers: documentHeaders });
		expect(launch.status).toBe(303);
		const admission = String(launch.headers.location);
		for (const [mode, dest] of [
			["cors", "empty"],
			["navigate", "empty"],
			["cors", "document"],
		]) {
			for (const route of ["/launch?canvas=read", admission]) {
				const refused = await probe(server, route, {
					headers: { ...documentHeaders, "Sec-Fetch-Mode": mode, "Sec-Fetch-Dest": dest },
				});
				expect(refused.status).toBe(403);
				expect(refused.headers.location).toBeUndefined();
			}
		}
		const built = await probe(server, admission, { headers: documentHeaders });
		expect(built.status).toBe(303);
		expect(new URL(String(built.headers.location)).origin).not.toBe(server.origin);
	});
	it("identifies the admitted course without credentials", async () => {
		const { server, projectDir } = await running();
		const response = await probe(server, "/api/identity");
		expect(response.status).toBe(200);
		expect(JSON.parse(response.text)).toEqual({ service: "praxity-studio", projectDir });
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.headers["referrer-policy"]).toBe("no-referrer");
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it.each(["/", "/launch", "/launch?canvas=read", "/api/identity"])(
		"keeps Host and Origin guards on %s",
		async (route) => {
			const { server } = await running();
			const port = new URL(server.origin).port;
			const forbiddenHeaders: Record<string, string>[] = [
				{ Host: `evil.example:${port}` },
				{ Host: `localhost:${port}` },
				{ Origin: "https://evil.example" },
				{ Origin: "http://127.0.0.1:1" },
				{ Origin: "null" },
			];
			for (const headers of forbiddenHeaders) {
				const response = await probe(server, route, { headers });
				expect(response.status).toBe(403);
				expect(response.headers.location).toBeUndefined();
				expect(response.headers["access-control-allow-origin"]).toBeUndefined();
			}
			const duplicate = await probe(server, route, {
				headers: [
					"Host",
					new URL(server.origin).host,
					"Origin",
					server.origin,
					"Origin",
					server.origin,
				],
			});
			expect(duplicate.status).toBe(400);
			for (const method of ["POST", "HEAD", "OPTIONS"]) {
				const response = await probe(server, route, { method });
				expect(response.status).toBe(405);
				expect(response.headers.location).toBeUndefined();
			}
		},
	);

	it("launches Read admission with a private redirect", async () => {
		const { server } = await running();
		const allowedHeaders: Record<string, string>[] = [{}, { Origin: server.origin }];
		for (const headers of allowedHeaders) {
			const response = await probe(server, "/launch", { headers });
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/launch?canvas=read#");
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(response.headers["referrer-policy"]).toBe("no-referrer");
			expect(
				Object.keys(response.headers).filter((name) => name.startsWith("access-control-")),
			).toEqual([]);
			expect(response.text).toBe("");
		}
	});

	it("binds the requested loopback port with a plain ready URL", async () => {
		const { server: temporary } = await running();
		const port = Number(new URL(temporary.origin).port);
		await temporary.close();
		const options = { ...(await fixture()), appVersion: "0.3.0", port };
		const server = await startStudioServer(options);
		servers.push(server);
		expect(server.origin).toBe(`http://127.0.0.1:${port}`);
		expect((await probe(server, "/")).status).toBe(303);
		expect((await probe(server, "/api/session")).status).toBe(404);
		expect(server.readyUrl).toBe(`${server.origin}/`);
	}, 15_000);

	it("refreshes the session snapshot after its initial lesson is removed", async () => {
		const { server, projectDir } = await running();
		await rm(join(projectDir, "second.prax"));
		await writeFile(join(projectDir, "course.yaml"), "title: Test\nlessons: [first.prax]\n");
		const response = await retainedSnapshot(server);
		expect(response.status).toBe(200);
		expect(JSON.parse(response.text).result.project.lessonFilename).toBe("first.prax");
	});

	it.each(["unknown", "100-continue"])(
		"applies private headers to early Expect responses: %s",
		async (expectation) => {
			const { server } = await running(true);
			const launch = await probe(server, "/launch?canvas=read");
			const built = await probe(server, String(launch.headers.location));
			const mediaOrigin = new URL(String(built.headers.location)).origin;
			for (const origin of [server.origin, mediaOrigin]) {
				const response = await probe({ ...server, origin }, "/missing", {
					headers: { Expect: expectation },
				});
				expect(response.status).toBe(417);
				expect(response.headers["content-security-policy"]).toEqual(expect.any(String));
				expect(response.headers["cache-control"]).toBe("no-store");
				expect(response.headers["referrer-policy"]).toBe("no-referrer");
				expect(response.headers["x-content-type-options"]).toBe("nosniff");
				expect(response.headers["access-control-allow-origin"]).toBeUndefined();
			}
		},
	);

	it("publishes the rooted tree after lesson unlink without a watcher failure", async () => {
		const { projectDir } = await fixture();
		const session = await createStudioProjectSession(projectDir, "test");
		const events: unknown[] = [];
		session.subscribe((event) => events.push(event));
		try {
			await rm(join(projectDir, "second.prax"));
			await vi.waitFor(() =>
				expect(events).toContainEqual({ type: "treeChanged", tree: expect.any(Array) }),
			);
			expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
			const tree = (
				events.find((event) => (event as { type: string }).type === "treeChanged") as {
					tree: { path: string }[];
				}
			).tree;
			expect(tree.map((node) => node.path)).not.toContain("second.prax");
			expect(tree.map((node) => node.path)).toContain("first.prax");
		} finally {
			await session.close();
		}
	}, 15_000);
	it("binds loopback, bootstraps manifest order even for identical lessons, and refuses retired shell and project assets", async () => {
		const { server, token, projectDir } = await running();
		expect(new URL(server.origin).hostname).toBe("127.0.0.1");
		expect(new URL(server.readyUrl).hash).toBe("");
		const page = await probe(server, "/");
		expect(page.status).toBe(303);
		expect(page.text).not.toContain(token);
		expect(page.text).not.toContain(projectDir);
		const session = await retainedSnapshot(server);
		expect(session.status).toBe(200);
		expect(JSON.parse(session.text).result.project).toMatchObject({
			projectPath: projectDir,
			lessonFilename: "second.prax",
			grammar: source,
		});
		expect(JSON.parse(session.text).result.appVersion).toBe("0.3.0");
		await writeFile(join(projectDir, "evil.html"), "<script>window.opener.pwned=true</script>");
		await writeFile(join(projectDir, "evil.svg"), '<svg onload="window.pwned=true"/>');
		for (const path of [
			"/evil.html",
			"/evil.svg",
			"/assets/evil.svg",
			"/course.yaml",
			"/first.prax",
			"/app.js.map",
			`/api/session?token=${token}`,
		]) {
			expect((await probe(server, path)).status).toBe(404);
		}
		expect((await probe(server, "/app.js")).status).toBe(404);
	});

	it("adds a restrictive CSP, private caching policy, and no CORS headers to every response", async () => {
		const { server } = await running();
		for (const path of ["/", "/app.js", "/unknown", "/api/session"]) {
			const result = await probe(server, path);
			expect(result.headers["content-security-policy"]).toContain("script-src 'self'");
			expect(result.headers["content-security-policy"]).toContain("object-src 'none'");
			expect(result.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
			expect(result.headers["content-security-policy"]).not.toContain("https:");
			expect(result.headers["referrer-policy"]).toBe("no-referrer");
			expect(result.headers["cache-control"]).toBe("no-store");
			expect(result.headers["x-content-type-options"]).toBe("nosniff");
			expect(result.headers["access-control-allow-origin"]).toBeUndefined();
		}
	});

	it("refuses duplicate Origin or authorization headers", async () => {
		const { server, token } = await running();
		const common = ["Host", new URL(server.origin).host, "Content-Type", "application/json"];
		for (const repeated of [
			["Origin", server.origin, "Origin", server.origin, "Authorization", `Bearer ${token}`],
			[
				"Origin",
				server.origin,
				"Authorization",
				`Bearer ${token}`,
				"Authorization",
				`Bearer ${token}`,
			],
		]) {
			const result = await probe(server, "/api/rpc", {
				method: "POST",
				headers: [...common, ...repeated],
				body: JSON.stringify({ method: "configRead", args: {} }),
			});
			expect(result.status).toBe(400);
		}
	});

	it("bounds HTTP headers while retaining the private response policy on parser rejection", async () => {
		const { server } = await running();
		const result = await probe(server, "/", {
			headers: { Authorization: `Bearer ${"a".repeat(20_000)}` },
		});
		expect(result.status).toBe(431);
		expect(result.headers["content-security-policy"]).toContain("script-src 'self'");
		expect(result.headers["cache-control"]).toBe("no-store");
		expect(result.headers["referrer-policy"]).toBe("no-referrer");
		expect(result.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("loads courses without rewriting a missing course identity or inheriting a parent workspace", async () => {
		const { server, token, projectDir, root } = await running();
		await writeFile(join(root, "workspace.yaml"), "locale: fr\n");
		const result = await service(server, token, "courseLoad", { courseDir: projectDir });
		expect(result.status).toBe(200);
		const course = JSON.parse(result.text).result;
		expect(course.manifestSource).toBe("title: Test\nlessons: [second.prax, first.prax]\n");
		expect(course.workspacePath).toBeNull();
		expect(course.lessons.map((lesson: { filename: string }) => lesson.filename)).toEqual([
			"second.prax",
			"first.prax",
		]);
		expect(await readFile(join(projectDir, "course.yaml"), "utf8")).toBe(
			"title: Test\nlessons: [second.prax, first.prax]\n",
		);
	});

	it.each(["localhost", "127.0.0.1", "evil.example", "127.0.0.1:1"])(
		"rejects wrong Host %s",
		async (Host) => {
			const { server, token } = await running();
			expect((await probe(server, "/", { headers: { Host } })).status).toBe(403);
			expect((await rpc(server, token, "configRead", {}, { Host })).status).toBe(403);
		},
	);

	it.each(["null", "http://evil.example", "http://localhost:1"])(
		"rejects Origin %s, even with the capability",
		async (Origin) => {
			const { server, token } = await running();
			expect((await rpc(server, token, "configRead", {}, { Origin })).status).toBe(403);
			expect(
				(
					await probe(server, "/api/session", {
						headers: { Origin, Authorization: `Bearer ${token}` },
					})
				).status,
			).toBe(403);
		},
	);

	it("subscribes to external changes and closes listeners idempotently", async () => {
		const { server, token, projectDir } = await running();
		const session = (await testSession(server)).session;
		const changes: unknown[] = [];
		let changed = (_event: unknown) => {};
		const delivered = new Promise<unknown>((resolve) => {
			changed = resolve;
		});
		const unsubscribe = session.subscribe((event) => {
			changes.push(event);
			if (event.type === "grammarChanged") changed(event);
		});
		const externalSource = source.replace(
			"Hello",
			`External ${"texte français 世界 ".repeat(10_000)}`,
		);
		await writeFile(join(projectDir, "second.prax"), externalSource);
		expect(await delivered).toMatchObject({ type: "grammarChanged", grammar: externalSource });
		expect(JSON.stringify(changes)).not.toContain(token);
		unsubscribe();
		await server.close();
		await server.close();
		await expect(fetch(`${server.origin}/`)).rejects.toThrow();
	}, 15_000);

	it("does not expose a capability in project files or through a public bootstrap", async () => {
		const { server, token, projectDir } = await running();
		const manifest = await readFile(join(projectDir, "course.yaml"), "utf8");
		expect(manifest).toBe("title: Test\nlessons: [second.prax, first.prax]\n");
		expect((await probe(server, "/api/session")).status).toBe(404);
		expect((await probe(server, `/#session=${token}`)).text).not.toContain(token);
	});
});

describe("Studio startup admission", () => {
	it("refuses the lock cache, its ancestors and canonical aliases before listening", async () => {
		const files = await fixture();
		const cache = projectLockCacheDirectory();
		await mkdir(cache, { recursive: true });
		const alias = join(files.root, "cache-alias");
		await symlink(cache, alias, "junction");
		for (const projectDir of [cache, join(cache, ".."), alias]) {
			await expect(
				startStudioServer({ ...files, projectDir, appVersion: "test" }),
			).rejects.toMatchObject({ code: "ELOCKCACHE" });
		}
	});
	it("accepts one standalone lesson and rejects an ambiguous folder without listening", async () => {
		const files = await fixture("");
		await expect(startStudioServer({ ...files, appVersion: "test" })).rejects.toThrow(/ambiguous/i);
		await rm(join(files.projectDir, "first.prax"));
		const server = await startStudioServer({ ...files, appVersion: "test" });
		servers.push(server);
		const result = await retainedSnapshot(server);
		expect(JSON.parse(result.text).result.project.lessonFilename).toBe("second.prax");
	});

	it("rejects escaping and dangling manifest/config/lesson links before listening", async () => {
		for (const name of ["course.yaml", "praxity.json", "second.prax"]) {
			for (const dangling of [false, true]) {
				const files = await fixture();
				const outside = join(files.root, "outside");
				if (!dangling) await writeFile(outside, source);
				await rm(join(files.projectDir, name), { force: true });
				await symlink(outside, join(files.projectDir, name));
				await expect(startStudioServer({ ...files, appVersion: "test" })).rejects.toThrow();
			}
		}
	}, 20_000);

	it("refuses hidden or traversing manifest lesson names", async () => {
		const files = await fixture();
		for (const filename of ["../outside.prax", ".praxity/private.prax", "missing.prax"]) {
			await writeFile(join(files.projectDir, "course.yaml"), `lessons: [${filename}]\n`);
			await expect(startStudioServer({ ...files, appVersion: "test" })).rejects.toThrow();
		}
	});
});
