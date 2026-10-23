import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";
import test from "node:test";
export function registerPublisherGuardTests(workflow) {
	const publish = workflow.jobs.publish;
	const publishStep = publish.steps.find((entry) => entry.id === "candidate");
	const cleanup = publish.steps.at(-1);
	const bash =
		process.platform === "win32"
			? join(
					process.env.ProgramFiles ??
						join(process.env.SystemDrive ?? parsePath(process.execPath).root, "Program Files"),
					"Git/bin/bash.exe",
				)
			: "/bin/bash";
	const shellPath = (path) => path.replaceAll("\\", "/");
	const commandWords = (script) => {
		const flattened = script.replace(/^\s*#.*$/gm, "").replace(/\\\n/g, " ");
		const substitutions = [...flattened.matchAll(/\$\(([^)]*)\)/g)].flatMap((match) => {
			const body = match[1].trim();
			if (body.startsWith("<")) {
				assert.match(body, /^< (?:[A-Za-z0-9._-]+|"[^"\n]+")$/);
				return [];
			}
			return commandWords(body);
		});
		const unquoted = flattened
			.replace(/\$\([^)]*\)/g, "SUB")
			.replace(/'(?:[^']*)'|"(?:\\.|[^"\\])*"/g, "ARG")
			.replace(/\b([A-Za-z_][A-Za-z0-9_]*\+?=)\([^\n)]*\)/g, "$1ARRAY")
			.replace(/\[\[[^\n]*?\]\]/g, "[[");
		assert.doesNotMatch(script, /`/);
		assert.doesNotMatch(unquoted, /\beval\b|\bexec\b|\bcommand\b|\bsource\b/);
		assert.doesNotMatch(unquoted, /(?:^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\)/);
		for (const line of unquoted.split("\n")) {
			if (/^\s*[A-Za-z_][A-Za-z0-9_]*\+?=/.test(line))
				assert.match(line, /^\s*[A-Za-z_][A-Za-z0-9_]*\+?=\S*\s*$/);
			if (/^\s*(?:if|elif)\b/.test(line)) assert.match(line, /^\s*(?:if|elif) \[\[; then\s*$/);
			if (/^\s*while\b/.test(line)) assert.match(line, /^\s*while IFS= read -r line; do\s*$/);
			if (/^\s*for\b/.test(line))
				assert.match(line, /^\s*for [A-Za-z_][A-Za-z0-9_]* in [^;]+; do\s*$/);
			if (/^\s*(?:then|do|else)\b/.test(line)) assert.match(line, /^\s*(?:then|do|else)\s*$/);
		}
		const words = [...unquoted.matchAll(/(?:^|\n|;|&&|\|\||\|(?!\|)|\()\s*([^\s;()]+)/g)].map(
			(match) => match[1],
		);
		return [...words, ...substitutions, ...unquoted.matchAll(/\bwhile IFS= (\S+)/g)].map((word) =>
			typeof word === "string" ? word : word[1],
		);
	};

	test("every publish command is a shell builtin or an absolute SIP-protected binary", () => {
		const allowed =
			/^(?:\/usr\/bin\/(?:curl|shasum|basename|plutil|python3)|\/bin\/(?:bash|ls|rm)|set|shopt|cd|read|printf|exit|continue|\[\[|if|elif|then|else|fi|for|while|do|done|[A-Za-z_][A-Za-z0-9_]*(?:\+)?=\S*)$/;
		for (const entry of [publishStep, cleanup]) {
			for (const word of commandWords(entry.run)) assert.match(word, allowed, entry.name);
		}
		for (const unsafe of [
			"gh release",
			"curl https://example.com",
			"echo ok; node bad",
			"x=$(gh api)",
			'x="$(/usr/bin/curl https://example.com | node bad)"',
			'printf "%s" "$(node bad)"',
		]) {
			assert.ok(
				commandWords(unsafe).some((word) => !allowed.test(word)),
				unsafe,
			);
		}
		const curlCalls = publishStep.run.replace(/\\\n/g, " ").match(/\/usr\/bin\/curl\b[^\n]*/g);
		assert.equal(curlCalls.length, 2);
		// The token reaches curl on stdin, never in a process argument.
		assert.doesNotMatch(
			publishStep.run.replace(/^\s*.*printf 'Authorization.*$/gm, ""),
			/GITHUB_TOKEN/,
		);
		assert.equal(
			publishStep.run.match(
				/printf 'Authorization: Bearer %s\\n' "\$GITHUB_TOKEN" \| \/usr\/bin\/curl /g,
			)?.length,
			2,
		);
		for (const call of curlCalls) {
			assert.match(call, /^\/usr\/bin\/curl -q --fail-with-body --silent --show-error/);
			assert.match(call, / -H @- /);
		}
	});

	const runShell = (script, env) =>
		new Promise((resolve, reject) => {
			const child = spawn(bash, ["-e", "-o", "pipefail", "-c", script], { env });
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (data) => {
				stdout += data;
			});
			child.stderr.on("data", (data) => {
				stderr += data;
			});
			child.once("error", reject);
			child.once("close", (status) => resolve({ status, stdout, stderr }));
		});

	test("handoff cleanup refuses run IDs that could remove neighbouring candidates", async (t) => {
		const directory = mkdtempSync(join(tmpdir(), "cli-cleanup-"));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const handoff = join(directory, ".praxity-candidate-handoff");
		mkdirSync(join(handoff, "123"), { recursive: true });
		const archive = join(handoff, "123", "keep.tar.gz");
		writeFileSync(archive, "another candidate");
		for (const runId of ["", "..", "123/..", "123/", "branch-name"]) {
			const result = await runShell(cleanup.run, {
				...process.env,
				HOME: shellPath(directory),
				CANDIDATE_RUN_ID: runId,
				PATH: "/nonexistent",
			});
			assert.notEqual(result.status, 0, `Cleanup accepted ${JSON.stringify(runId)}`);
			assert.equal(readFileSync(archive, "utf8"), "another candidate");
		}
	});

	test("publish scripts create a draft, upload validated bytes and always remove the handoff", async (t) => {
		const archive = "praxity-cli-0.1.0-darwin-arm64.tar.gz";
		const bytes = Buffer.from("candidate archive bytes");
		const sha = "a".repeat(40);
		const digest = createHash("sha256").update(bytes).digest("hex");
		const sum = `${digest} *${archive}\n`;
		const cases = [
			{ name: "valid candidate", ok: true },
			{ name: "before-cutover target equals source", ok: true, toolingSha: sha },
			{ name: "invalid tooling SHA", toolingSha: "main" },
			{ name: "tampered archive", files: { [archive]: "tampered" } },
			{
				name: "rewritten handoff and checksum",
				files: {
					[archive]: "tampered",
					[`${archive}.sha256`]: `${createHash("sha256").update("tampered").digest("hex")} *${archive}\n`,
				},
			},
			{ name: "extra file", files: { "unrelated.txt": "extra" } },
			{ name: "hidden file", files: { ".hidden": "extra" } },
			{ name: "misnamed file", files: { "praxity-cli-bad name.tar.gz": "extra" } },
			{ name: "missing checksum", remove: `${archive}.sha256` },
			{ name: "orphan checksum", files: { "praxity-cli-orphan.tar.gz.sha256": sum } },
			{ name: "invalid commit", files: { "commit.txt": "branch-name\n" } },
			{ name: "uppercase source", files: { "commit.txt": `${"A".repeat(40)}\n` } },
			{ name: "missing commit", remove: "commit.txt" },
			{
				name: "checksum names another path",
				files: { [`${archive}.sha256`]: `${digest} */etc/passwd\n` },
			},
			{
				name: "checksum of a second archive cannot authorize this archive",
				files: {
					"praxity-cli-0.1.0-darwin-x64.tar.gz": bytes,
					"praxity-cli-0.1.0-darwin-x64.tar.gz.sha256": sum,
				},
			},
			{ name: "checksum has extra records", files: { [`${archive}.sha256`]: `${sum}${sum}` } },
			{ name: "empty handoff", remove: archive, files: { [`${archive}.sha256`]: null } },
			{ name: "release API fails", apiFailure: "create" },
			{ name: "asset API fails", apiFailure: "upload" },
			{ name: "unexpected upload host", badUrl: true },
			{ name: "missing release ID", missingId: true },
		];
		for (const scenario of cases) {
			await t.test(scenario.name, async (t) => {
				const directory = mkdtempSync(join(tmpdir(), "cli-publish-"));
				t.after(() => rmSync(directory, { recursive: true, force: true }));
				const handoff = join(directory, ".praxity-candidate-handoff/123");
				mkdirSync(handoff, { recursive: true });
				const files = {
					[archive]: bytes,
					[`${archive}.sha256`]: sum,
					"commit.txt": `${sha}\n`,
					...scenario.files,
				};
				for (const [name, data] of Object.entries(files)) {
					if (data !== null && name !== scenario.remove) writeFileSync(join(handoff, name), data);
				}
				// A previous build could have planted a curl config in the user's home.
				writeFileSync(join(directory, ".curlrc"), 'url = "http://127.0.0.1:1/forbidden"\n');
				const requests = [];
				const server = createServer(async (request, response) => {
					const chunks = [];
					for await (const chunk of request) chunks.push(chunk);
					requests.push({
						method: request.method,
						url: request.url,
						headers: request.headers,
						body: Buffer.concat(chunks),
					});
					response.setHeader("Content-Type", "application/json");
					const create = request.url === "/repos/owner/private/releases";
					if (scenario.apiFailure === (create ? "create" : "upload")) {
						response.writeHead(500).end('{"message":"fake failure"}');
						return;
					}
					response.writeHead(201).end(
						JSON.stringify(
							create
								? {
										id: scenario.missingId ? undefined : 42,
										upload_url: `${scenario.badUrl ? "https://untrusted.example" : api}/repos/owner/private/releases/42/assets{?name,label}`,
										author: { id: 900, login: "builder" },
									}
								: { id: 77 },
							null,
							2,
						),
					);
				});
				await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
				t.after(() => new Promise((resolve) => server.close(resolve)));
				const api = `http://127.0.0.1:${server.address().port}`;
				// Replace only platform/network adapters. Policy assertions above inspect
				// the original script; Windows executes real Git curl and SHA-256 tools.
				let script = publishStep.run.replace("https://uploads.github.com", api);
				if (process.platform === "win32") {
					script = script
						.replaceAll("/usr/bin/curl", "/mingw64/bin/curl")
						.replaceAll("/usr/bin/shasum -a 256", "/usr/bin/sha256sum");
				}
				const env = {
					...process.env,
					HOME: shellPath(directory),
					CANDIDATE_RUN_ID: "123",
					GITHUB_API_URL: api,
					GITHUB_REPOSITORY: "owner/private",
					GITHUB_SHA: scenario.toolingSha ?? "b".repeat(40),
					GITHUB_TOKEN: "fake-api-token",
					GITHUB_OUTPUT: shellPath(join(directory, "outputs")),
					EXPECTED_ARM64_NAME: archive,
					EXPECTED_ARM64_SHA256: digest,
					EXPECTED_X64_NAME: "praxity-cli-0.1.0-darwin-x64.tar.gz",
					EXPECTED_X64_SHA256: digest,
					PATH: "/nonexistent",
				};
				let result;
				try {
					result = await runShell(script, env);
				} finally {
					const removed = await runShell(cleanup.run, env);
					assert.equal(removed.status, 0, removed.stderr);
					assert.equal(existsSync(handoff), false);
				}
				assert.equal(result.status === 0, Boolean(scenario.ok), result.stderr);
				assert.doesNotMatch(result.stdout + result.stderr, /fake-api-token/);
				if (scenario.ok) {
					assert.equal(readFileSync(join(directory, "outputs"), "utf8"), "release_id=42\n");
					assert.equal(requests.length, 3);
					assert.equal(requests[0].url, "/repos/owner/private/releases");
					assert.deepEqual(JSON.parse(requests[0].body), {
						tag_name: "cli-candidate-123",
						target_commitish: scenario.toolingSha ?? "b".repeat(40),
						body: `Studio SHA: ${sha}`,
						draft: true,
						prerelease: true,
					});
					for (const [index, name, expected] of [
						[1, archive, bytes],
						[2, `${archive}.sha256`, Buffer.from(sum)],
					]) {
						assert.equal(
							requests[index].url,
							`/repos/owner/private/releases/42/assets?name=${name}`,
						);
						assert.deepEqual(requests[index].body, expected);
						assert.equal(requests[index].headers["content-type"], "application/octet-stream");
					}
				} else {
					assert.equal(
						requests.length,
						scenario.apiFailure === "upload"
							? 2
							: scenario.apiFailure === "create" || scenario.badUrl || scenario.missingId
								? 1
								: 0,
					);
				}
				for (const request of requests) {
					assert.equal(request.method, "POST");
					assert.equal(request.headers.authorization, "Bearer fake-api-token");
				}
			});
		}
	});
}
