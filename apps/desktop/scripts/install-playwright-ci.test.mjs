import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { retentionFixture, stepArguments } from "./ci-test-support.mjs";

const action = parse(
	readFileSync(
		new URL("../../../.github/actions/install-playwright/action.yml", import.meta.url),
		"utf8",
	),
);
const steps = action.runs.steps;
const prepare = steps.find((step) => step.name === "Prepare apt archive reuse");
const install = steps.find((step) => step.name === "Install browser and system dependencies");
const collect = steps.find((step) => step.name === "Collect current dependency archives");

// Privileged modes/owners are recorded; fixture mkdir/cp also work on Windows without _apt.
const sandboxSudo = `
sudo() {
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/sudo-commands"
  if [[ "$1" == cp || ( "$1" == install && "$2" != -d ) ]]; then
    if [[ -n "\${TEST_RESTORE_EXIT:-}" ]]; then return "$TEST_RESTORE_EXIT"; fi
  fi
  if [[ "$1" == install ]]; then
    shift
    args=()
    while (($#)); do
      case "$1" in
        -o|-g|-m) shift 2 ;;
        *) args+=("$1"); shift ;;
      esac
    done
    if [[ "\${args[0]}" == -d ]]; then
      command mkdir -p "\${args[@]:1}"
    else
      command cp "\${args[@]}"
    fi
  else
    "$@"
  fi
}
`;

test("same-name, same-size poisoned archives stay partial until apt validates them", (t) => {
	const root = retentionFixture(t, { "temp/playwright-debs/pkg_1_amd64.deb": "poison" });
	const path = (name) => fileURLToPath(new URL(name, root)).replaceAll("\\", "/");
	mkdirSync(new URL("apt-config/", root));
	const script = prepare.run
		.replaceAll("/etc/apt/apt.conf.d", path("apt-config"))
		.replaceAll("/var/cache/apt/archives", path("archives"));
	stepArguments({}, { run: sandboxSudo + script, env: { RUNNER_TEMP: path("temp") } }, 0, root);
	assert.equal(Buffer.byteLength("poison"), Buffer.byteLength("signed"));
	assert.equal(existsSync(new URL("archives/pkg_1_amd64.deb", root)), false);
	assert.equal(readFileSync(new URL("archives/partial/pkg_1_amd64.deb", root), "utf8"), "poison");
	const commands = readFileSync(new URL("temp/sudo-commands", root), "utf8");
	assert.ok(commands.includes(`install -d -o _apt -g root -m 0700 ${path("archives/partial")}`));
	assert.ok(
		commands.includes(
			`install -o _apt -g root -m 0644 ${path("temp/playwright-debs/pkg_1_amd64.deb")} ${path("archives/partial/")}`,
		),
	);
});

test("a failed cached-archive restore fails preparation before installation can start", (t) => {
	const root = retentionFixture(t, { "temp/playwright-debs/pkg_1_amd64.deb": "cached" });
	const path = (name) => fileURLToPath(new URL(name, root)).replaceAll("\\", "/");
	mkdirSync(new URL("apt-config/", root));
	const script = prepare.run
		.replaceAll("/etc/apt/apt.conf.d", path("apt-config"))
		.replaceAll("/var/cache/apt/archives", path("archives"));
	stepArguments(
		{},
		{
			run: `${sandboxSudo}${script}\nprintf started > "$RUNNER_TEMP/install-started"`,
			env: { RUNNER_TEMP: path("temp"), TEST_RESTORE_EXIT: "52" },
		},
		52,
		root,
	);
	assert.equal(existsSync(new URL("temp/install-started", root)), false);
});

test("dependency keys isolate OS, architecture, browser and version; only image revision falls back", () => {
	const restore = steps.find((step) => step.id === "debs");
	const key =
		"playwright-debs-v1-${{ runner.os }}-${{ runner.arch }}-${{ steps.image.outputs.os }}-${{ inputs.playwright-version }}-${{ inputs.browser }}-";
	assert.equal(restore.with.key, `${key}\${{ steps.image.outputs.version }}`);
	assert.equal(restore.with["restore-keys"].trim(), key);
	assert.equal(restore.with.path, "${{ runner.temp }}/playwright-debs");
	assert.deepEqual(steps[0].run.trim().split("\n"), [
		'echo "os=${ImageOS:?}" >> "$GITHUB_OUTPUT"',
		'echo "version=${ImageVersion:?}" >> "$GITHUB_OUTPUT"',
	]);
	const save = steps.at(-1);
	assert.equal(save.uses, "actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830");
	assert.equal(save.if, "steps.debs.outputs.cache-hit != 'true'");
	assert.equal(save.with.key, "${{ steps.debs.outputs.cache-primary-key }}");
	assert.equal(save.with.path, restore.with.path);
	assert.ok(steps.indexOf(prepare) < steps.indexOf(install));
	assert.ok(steps.indexOf(install) < steps.indexOf(collect));
	assert.equal(install.if, undefined, "Always install system dependencies, even on an exact hit");
	assert.equal(collect.if, undefined, "Collect and save only after a successful install");
	assert.equal(install["continue-on-error"], undefined);
	assert.deepEqual(install.env, {
		PLAYWRIGHT_PACKAGE: "${{ inputs.package }}",
		PLAYWRIGHT_BROWSER: "${{ inputs.browser }}",
	});
});

test("runner image identity comes from the runner environment and refuses missing fields", (t) => {
	const root = retentionFixture(t, { output: "" });
	const env = {
		GITHUB_OUTPUT: fileURLToPath(new URL("output", root)),
		ImageOS: "ubuntu24",
		ImageVersion: "20261020.1.0",
	};
	stepArguments({}, { ...steps[0], env }, 0, root);
	assert.equal(
		readFileSync(new URL("output", root), "utf8"),
		"os=ubuntu24\nversion=20261020.1.0\n",
	);
	for (const field of ["ImageOS", "ImageVersion"])
		stepArguments({}, { ...steps[0], env: { ...env, [field]: "" } }, 1, root);
});

for (const cached of [false, true]) {
	for (const [failure, downloads] of [
		[0, true],
		[0, false],
		[37, true],
	]) {
		test(`apt archive lifecycle, cached=${cached}, downloads=${downloads}, install exit=${failure}`, (t) => {
			const root = retentionFixture(t, {
				"apt-config/docker-clean": "delete downloaded debs\n",
				summary: "",
				...(cached ? { "temp/playwright-debs/existing.deb": "cached package bytes" } : {}),
			});
			mkdirSync(new URL("temp/", root), { recursive: true });
			const path = (name) => fileURLToPath(new URL(name, root)).replaceAll("\\", "/");
			// Redirect privileged filesystem adapters into this fixture; apt and pnpm are fakes.
			const script = [prepare.run, install.run, collect.run]
				.join("\n")
				.replaceAll("/etc/apt/apt.conf.d", path("apt-config"))
				.replaceAll("/var/cache/apt/archives", path("archives"));
			assert.ok(!script.includes("/etc/apt/") && !script.includes("/var/cache/apt/"));
			const run = `${sandboxSudo}
pnpm() {
  printf '%s\\n' "$@" > "$RUNNER_TEMP/arguments"
  test ! -e "${path("apt-config/docker-clean")}" || return 41
  grep -q 'Keep-Downloaded-Packages "true"' "${path("apt-config/99playwright-cache")}" || return 42
  ${cached ? `test "$(cat '${path("archives/partial/existing.deb")}')" = 'cached package bytes' || return 43` : ""}
  ${downloads ? `printf 'new package bytes' > "${path("archives/current.deb")}"` : ":"}
  return "$TEST_INSTALL_EXIT"
}
apt-get() {
  test "$1" = autoclean || return 44
  rm -f "${path("archives/existing.deb")}"
}
${script}`;
			stepArguments(
				{},
				{
					run,
					env: {
						RUNNER_TEMP: path("temp"),
						GITHUB_STEP_SUMMARY: path("summary"),
						PLAYWRIGHT_PACKAGE: "@praxity/export-pipeline",
						PLAYWRIGHT_BROWSER: "webkit",
						TEST_INSTALL_EXIT: String(failure),
					},
				},
				failure,
				root,
			);
			assert.equal(
				readFileSync(new URL("temp/arguments", root), "utf8"),
				"--filter\n@praxity/export-pipeline\nexec\nplaywright\ninstall\n--with-deps\nwebkit\n",
			);
			if (failure) {
				assert.deepEqual(
					readdirSync(new URL("temp/playwright-debs", root)),
					cached ? ["existing.deb"] : [],
				);
				assert.equal(readFileSync(new URL("summary", root), "utf8"), "");
			} else if (!downloads) {
				assert.deepEqual(readdirSync(new URL("temp/playwright-debs", root)), []);
				assert.match(
					readFileSync(new URL("summary", root), "utf8"),
					/Playwright dependency archive bytes: \d+/,
				);
			} else {
				assert.deepEqual(readdirSync(new URL("temp/playwright-debs", root)), ["current.deb"]);
				assert.equal(
					readFileSync(new URL("temp/playwright-debs/current.deb", root), "utf8"),
					"new package bytes",
				);
				assert.match(
					readFileSync(new URL("summary", root), "utf8"),
					/Playwright dependency archive bytes: \d+/,
				);
				// A later package revision replaces the saved archive without stale bytes.
				writeFileSync(new URL("temp/playwright-debs/current.deb", root), "old package bytes");
				stepArguments(
					{},
					{
						run: collect.run.replaceAll("/var/cache/apt/archives", path("archives")),
						env: { RUNNER_TEMP: path("temp"), GITHUB_STEP_SUMMARY: path("summary") },
					},
					0,
					root,
					"sudo",
				);
				assert.equal(
					readFileSync(new URL("temp/playwright-debs/current.deb", root), "utf8"),
					"new package bytes",
				);
			}
		});
	}
}
