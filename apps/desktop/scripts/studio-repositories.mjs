export function studioRepositories(env = process.env) {
	const repositories = {};
	for (const [key, variable] of [
		["source", "STUDIO_SOURCE_REPO"],
		["candidate", "STUDIO_CANDIDATE_REPO"],
	]) {
		const value =
			env[variable] ?? (env.GITHUB_ACTIONS === "true" ? env.GITHUB_REPOSITORY : undefined);
		if (!value)
			throw Object.assign(new Error(`${variable} is required. Set it to owner/name.`), {
				code: "STUDIO_REPOSITORY_REQUIRED",
			});
		if (
			!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(value) ||
			/[\r\n]/.test(value) ||
			[".", ".."].includes(value.split("/")[1])
		)
			throw new Error(`${variable} must be a GitHub repository in owner/name format.`);
		repositories[key] = value;
	}
	return repositories;
}

export function studioRepositoryFromRemote(remote) {
	const value =
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(
			remote.trim(),
		)?.[1];
	if (!value) return undefined;
	try {
		return studioRepositories({ STUDIO_SOURCE_REPO: value, STUDIO_CANDIDATE_REPO: value }).source;
	} catch {
		return undefined;
	}
}
