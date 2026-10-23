import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./build-cli-archives.sh", import.meta.url)).replaceAll(
	"\\",
	"/",
);
const bash =
	process.platform === "win32"
		? join(
				execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
				"../../../bin/bash.exe",
			)
		: "bash";

// pnpm is the build/test boundary. Use real tar and hashing against architecture-
// specific fixture bytes so ordering and payload replacement affect the result.
const fixture = `
node() {
  if [[ "$*" == '-p process.arch' ]]; then printf '%s\\n' "$NATIVE_ARCH"; else command node "$@"; fi
}
pnpm() {
  printf '%s|%s|%s\\n' "$*" "\${TYPST_ARCH:-}" "\${PRAXITY_BROWSER_ARTIFACT:-}" >> commands.log
  [[ "$*" != "$FAIL_COMMAND" ]] || return 23
  if [[ "$*" == build:cli ]]; then
    mkdir -p dist/studio-cli/editor
    printf '%s' "$TYPST_ARCH" > dist/studio-cli/payload.txt
    printf '%s' "$TYPST_ARCH" > dist/studio-cli/editor/index.html
    printf '{"sourceTreeDirty":%s}' "$(if [[ -n "$(git status --porcelain)" ]]; then echo true; else echo false; fi)" > dist/studio-cli/inventory.json
    if [[ "$DIRTY_AFTER_BUILD" == "$TYPST_ARCH" ]]; then printf 'generated' > unexpected-source.txt; fi
  elif [[ "$*" == test:cli ]]; then
    [[ "$(cat dist/studio-cli/payload.txt)" == "$NATIVE_ARCH" ]] || return 24
  elif [[ "$*" == *e2e:browser-editor ]]; then
    [[ "$(cat "$PRAXITY_BROWSER_ARTIFACT/payload.txt")" == "$NATIVE_ARCH" ]] || return 24
  fi
  if [[ "$DIRTY_AFTER_TEST" == "$*" ]]; then
    mkdir -p apps/desktop/narration-targets-fixture
    printf 'fixture' > apps/desktop/narration-targets-fixture/lesson.prax
    printf 'fixture' > dist/studio-cli/unlisted-fixture.txt
  fi
}
# Git for Windows ships sha256sum, while macOS ships shasum.
if ! command -v shasum >/dev/null; then
  shasum() { [[ "$1 $2" == '-a 256' ]] || return 25; shift 2; sha256sum "$@"; }
fi
source "$ARCHIVE_SCRIPT" "$@"
`;

function withBuild(options, check) {
	const directory = mkdtempSync(join(tmpdir(), "studio-cli-archives-"));
	try {
		mkdirSync(join(directory, "apps/desktop"), { recursive: true });
		writeFileSync(join(directory, "apps/desktop/package.json"), '{"version":"1.2.3"}');
		writeFileSync(join(directory, ".gitignore"), "dist/\napps/desktop/release/\ncommands.log\n");
		execFileSync("git", ["init", "--quiet"], { cwd: directory });
		execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: directory });
		execFileSync("git", ["add", "."], { cwd: directory });
		execFileSync(
			"git",
			[
				"-c",
				"user.name=Ariel Harlap",
				"-c",
				"user.email=3870784+aharlap@users.noreply.github.com",
				"commit",
				"--quiet",
				"-m",
				"Archive fixture",
			],
			{ cwd: directory },
		);
		if (options.dirtyBefore) {
			const dirtyFile =
				options.dirtyBefore === "untracked" ? "unexpected-source.txt" : ".gitignore";
			writeFileSync(join(directory, dirtyFile), "fixture");
			if (options.dirtyBefore === "staged")
				execFileSync("git", ["add", dirtyFile], { cwd: directory });
		}
		const result = spawnSync(
			bash,
			["-c", fixture, "fixture", ...(options.browser ? ["--browser-editor"] : [])],
			{
				cwd: directory,
				env: {
					...process.env,
					ARCHIVE_SCRIPT: script,
					NATIVE_ARCH: options.native ?? "arm64",
					FAIL_COMMAND: options.fail ?? "",
					DIRTY_AFTER_BUILD: options.dirtyAfterBuild ?? "",
					DIRTY_AFTER_TEST: options.dirtyAfterTest ?? "",
				},
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		assert.ifError(result.error);
		check({
			directory,
			result,
			commands: existsSync(join(directory, "commands.log"))
				? readFileSync(join(directory, "commands.log"), "utf8").trim().split("\n")
				: [],
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("Intel builds seal arm64 first and run native x64 smoke against the sealed payload", () => {
	withBuild({ native: "x64" }, ({ result, commands }) => {
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.deepEqual(
			commands.map((line) => line.split("|").slice(0, 2)),
			[
				["build:cli", "arm64"],
				["build:cli", "x64"],
				["test:cli", ""],
			],
		);
	});
});

test("an unsupported native architecture refuses before any build", () => {
	withBuild({ native: "ia32" }, ({ result, commands }) => {
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Unsupported native architecture: ia32/);
		assert.deepEqual(commands, []);
	});
});

for (const browser of [false, true]) {
	test(`shared archive builder preserves both payloads and checksums, browser journeys ${browser}`, () => {
		withBuild(
			{
				browser,
				dirtyAfterTest: browser ? "--filter @praxity/desktop e2e:browser-editor" : "test:cli",
			},
			({ directory, result, commands }) => {
				assert.equal(result.status, 0, result.stdout + result.stderr);
				assert.deepEqual(
					commands.map((line) => line.split("|").slice(0, 2)),
					[
						["build:cli", "x64"],
						["build:cli", "arm64"],
						["test:cli", ""],
						...(browser ? [["--filter @praxity/desktop e2e:browser-editor", ""]] : []),
					],
				);
				for (const arch of ["arm64", "x64"]) {
					const name = `praxity-cli-1.2.3-macos-${arch}.tar.gz`;
					const archive = join(directory, "apps/desktop/release", name);
					const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
					assert.equal(
						execFileSync("tar", ["-xOf", archive, "studio-cli/inventory.json"], {
							encoding: "utf8",
						}),
						'{"sourceTreeDirty":false}',
					);
					assert.doesNotMatch(
						execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }),
						/unlisted-fixture/,
					);
					assert.equal(readFileSync(`${archive}.sha256`, "utf8"), `${hash} *${name}\n`);
					assert.equal(
						execFileSync("tar", ["-xOf", archive, "studio-cli/payload.txt"], { encoding: "utf8" }),
						arch,
					);
					assert.equal(
						execFileSync("tar", ["-xOf", archive, "studio-cli/editor/index.html"], {
							encoding: "utf8",
						}),
						arch,
					);
				}
			},
		);
	});
}

for (const fail of ["build:cli", "test:cli", "--filter @praxity/desktop e2e:browser-editor"]) {
	test(`archive builder fails when ${fail} fails`, () => {
		withBuild({ browser: true, fail }, ({ directory, result, commands }) => {
			assert.equal(result.status, 23, result.stdout + result.stderr);
			assert.equal(commands.at(-1).split("|")[0], fail);
			assert.equal(
				existsSync(join(directory, "apps/desktop/release/praxity-cli-1.2.3-macos-arm64.tar.gz")),
				fail !== "build:cli",
			);
		});
	});
}

for (const dirtyBefore of ["untracked", "modified", "staged"]) {
	test(`archive builder refuses ${dirtyBefore} source files before x64`, () => {
		withBuild({ dirtyBefore }, ({ directory, result, commands }) => {
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stderr, /Refusing x64 CLI build from a dirty source tree/);
			assert.match(
				result.stderr,
				dirtyBefore === "untracked" ? /unexpected-source\.txt/ : /\.gitignore/,
			);
			assert.deepEqual(commands, []);
			assert.equal(
				existsSync(join(directory, "apps/desktop/release/praxity-cli-1.2.3-macos-x64.tar.gz")),
				false,
			);
		});
	});
}

test("archive builder checks the tree again before arm64", () => {
	withBuild({ dirtyAfterBuild: "x64" }, ({ result, commands }) => {
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /Refusing arm64 CLI build from a dirty source tree/);
		assert.deepEqual(
			commands.map((line) => line.split("|").slice(0, 2)),
			[["build:cli", "x64"]],
		);
	});
});
