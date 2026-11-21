import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { buildCourseExportInput } from "../../../../apps/desktop/src/main/export/build-export-input-from-project";
import { persistFixtureIdentity } from "../../../../apps/desktop/src/test-utils/identity-fixture";
import { compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "./http-bytes";

const examples = resolve(import.meta.dirname, "../../../../docs/prax-format/examples");
const types: Record<string, string> = {
	html: "text/html",
	js: "text/javascript",
	css: "text/css",
	json: "application/json",
	woff2: "font/woff2",
	svg: "image/svg+xml",
};

type Edit = (file: string, source: string) => string;

export async function exampleCourseServer<Variant extends string>(
	example: string,
	variants: Record<Variant, Edit>,
) {
	const files = new Map<string, Buffer>();
	const pages = new Map<string, string[]>();
	for (const [variant, edit] of Object.entries<Edit>(variants)) {
		const root = await mkdtemp(join(tmpdir(), "example-course-"));
		try {
			await cp(join(examples, example), root, { recursive: true });
			for (const file of ["course.yaml", "en.prax", "fr.prax"])
				await writeFile(join(root, file), edit(file, await readFile(join(root, file), "utf8")));
			await persistFixtureIdentity(root);
			const input = await buildCourseExportInput({
				projectDir: root,
				scope: "course",
				viewerVersionPath: join(root, "viewer.version.json"),
				completionThreshold: 0.8,
				manifestPolicy: "read-only",
				inheritWorkspaceSettings: false,
			});
			const artifact = await compileCourse(input, { mode: "source" });
			try {
				const deployment = await deployCourse(artifact, { format: "html" });
				if (!("zip" in deployment)) throw new Error("Expected HTML package");
				for (const entry of new AdmZip(deployment.zip).getEntries())
					if (!entry.isDirectory) files.set(`/${variant}/${entry.entryName}`, entry.getData());
				pages.set(
					variant,
					artifact.manifest.pages.map((page) => `/${variant}/${page.slug}.html`),
				);
			} finally {
				await artifact.dispose();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
	const requests: string[] = [];
	const server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		requests.push(path);
		const bytes = files.get(path);
		if (!bytes) {
			response.writeHead(404).end();
			return;
		}
		response.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server address");
	const url = `http://127.0.0.1:${address.port}`;
	return {
		url,
		page: (variant: Variant, index: number) => {
			const path = pages.get(variant)?.[index];
			if (!path) throw new Error(`Missing ${variant} page ${index}`);
			return url + path;
		},
		requests,
		has: (path: string) => files.has(path),
		close: () =>
			new Promise<void>((done, reject) =>
				server.close((error) => (error ? reject(error) : done())),
			),
	};
}
