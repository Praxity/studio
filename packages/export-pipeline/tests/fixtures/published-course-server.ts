import { createServer } from "node:http";
import AdmZip from "adm-zip";
import { buildScormPackage, type CourseExportInput } from "../../src/build";
import { serveFixtureBytes } from "./http-bytes";

/** Serve the compiled package, including its fonts and hydration assets. */
export async function publishedCourseServer(course: CourseExportInput) {
	const result = await buildScormPackage(course, { mode: "source", format: "html" });
	const files = new Map<string, Buffer>(
		new AdmZip(result.zip)
			.getEntries()
			.filter((entry) => !entry.isDirectory)
			.map((entry) => [`/${entry.entryName}`, entry.getData()] as const),
	);
	const types: Record<string, string> = {
		html: "text/html",
		js: "text/javascript",
		css: "text/css",
		json: "application/json",
		woff2: "font/woff2",
		svg: "image/svg+xml",
		mp3: "audio/mpeg",
		wav: "audio/wav",
	};
	const server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		if (!bytes) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server address");
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}
