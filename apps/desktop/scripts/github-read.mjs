import { execFileSync } from "node:child_process";

// Keep large commit patches out of single responses; list reads follow every Link page.
export function githubRead(execute = execFileSync) {
	const request = (route, flags) =>
		JSON.parse(
			execute("gh", ["api", "--hostname", "github.com", ...flags, route], {
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			}),
		);
	const api = (route, fields) => request(route, fields ? ["--jq", fields] : []);
	api.list = (route, key) => {
		const pages = request(route, ["--paginate", "--slurp"]);
		if (!Array.isArray(pages)) throw new Error(`Invalid paginated GitHub response: ${route}`);
		return pages.flatMap((page) => {
			const items = key ? page[key] : page;
			if (!Array.isArray(items)) throw new Error(`Invalid GitHub list: ${route}`);
			return items;
		});
	};
	return api;
}
