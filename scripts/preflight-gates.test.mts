import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { collectGatePreflight, reportGatePreflight } from "./preflight-gates.mts";

const appId = "synthetic-app-id";
const secret = "synthetic-secret-never-emit";
const probe = {
	command: async () => "test-version",
	isFile: async () => true,
	read: async (path: string) =>
		path.endsWith("package.json")
			? JSON.stringify({ packageManager: "pnpm@10.28.2", engines: { node: ">=24.22.1 <25.0.0" } })
			: path.endsWith("pnpm-lock.yaml")
				? "lockfileVersion: '9.0'\n"
				: `SCORM_CLOUD_APP_ID=${appId}\nSCORM_CLOUD_SECRET_KEY='${secret}'\n`,
	browser: async () => ({ path: "browser.exe", version: "test-version" }),
	cloud: async () => 200,
};

for (const key of ["ProgramFiles", "ProgramFiles(x86)"]) {
	test(`preflight locates NVDA through ${key}`, async () => {
		const directory = join("/fixture", "installed-programs");
		const expected = join(directory, "NVDA/nvda.exe");
		const result = await collectGatePreflight({
			root: "/fixture",
			env: { [key]: directory },
			probe: {
				...probe,
				isFile: async (path: string) => !path.endsWith("nvda.exe") || path === expected,
			},
		});
		assert.equal(result.checks.NVDA.present, true);
		assert.equal(result.checks.NVDA.path, expected);
	});
}

test("preflight names every missing prerequisite and exits nonzero", async () => {
	const result = await collectGatePreflight({
		root: "/fixture",
		env: {},
		probe: {
			...probe,
			command: async () => undefined,
			isFile: async () => false,
			browser: async () => {
				throw new Error("missing browser");
			},
		},
	});
	const output: string[] = [];
	assert.equal(
		reportGatePreflight(result, (line) => output.push(line)),
		1,
	);
	for (const item of [
		"pnpm",
		"Chromium",
		"Firefox",
		"WebKit",
		"Typst",
		"xmllint",
		"Java",
		"ADL Manifest Tester",
		"Rustici scorm12",
		"Rustici scorm2004",
		"NVDA",
	]) {
		assert.ok(output.join("\n").includes(item), item);
	}
});

test("credentials stay out of JSON and output, including a transport exception", async () => {
	const result = await collectGatePreflight({
		root: "/fixture",
		env: {},
		probe: {
			...probe,
			cloud: async () => {
				throw new Error(`${appId}:${secret}`);
			},
		},
	});
	const output: string[] = [];
	assert.equal(
		reportGatePreflight(result, (line) => output.push(line)),
		1,
	);
	const serialized = JSON.stringify(result) + output.join("\n");
	assert.ok(!serialized.includes(appId));
	assert.ok(!serialized.includes(secret));
	assert.deepEqual(result.credentials, {
		appIdLength: appId.length,
		secretKeyLength: secret.length,
	});
});

test("a complete preflight passes and probes the API using in-memory credentials", async () => {
	let authenticated = false;
	const result = await collectGatePreflight({
		root: "/fixture",
		env: { PRAXITY_JAVA: "java.exe", PRAXITY_ADL_VALIDATOR: "adlvalidator.jar" },
		probe: {
			...probe,
			cloud: async (id: string, key: string) => {
				authenticated = id === appId && key === secret;
				return 200;
			},
		},
	});
	assert.equal(
		reportGatePreflight(result, () => {}),
		0,
	);
	assert.equal(authenticated, true);
});

test("ADL tools require explicit configuration even when probes would succeed", async () => {
	const result = await collectGatePreflight({ root: "/fixture", env: {}, probe });
	assert.ok(result.missing.includes("Java"));
	assert.ok(result.missing.includes("ADL Manifest Tester"));
});

test("configured but unavailable ADL tools fail preflight", async () => {
	const result = await collectGatePreflight({
		root: "/fixture",
		env: { PRAXITY_JAVA: "missing-java", PRAXITY_ADL_VALIDATOR: "missing-validator.jar" },
		probe: {
			...probe,
			command: async (file: string) => (file === "missing-java" ? undefined : "test-version"),
			isFile: async (path: string) => path !== "missing-validator.jar",
		},
	});
	assert.ok(result.missing.includes("Java"));
	assert.ok(result.missing.includes("ADL Manifest Tester"));
});

test("missing credentials and rejected API authentication fail closed", async () => {
	for (const status of [401, 403, 500]) {
		const result = await collectGatePreflight({
			root: "/fixture",
			env: {},
			probe: { ...probe, cloud: async () => status },
		});
		assert.ok(result.missing.includes("SCORM Cloud API"));
	}
	const result = await collectGatePreflight({
		root: "/fixture",
		env: {},
		probe: {
			...probe,
			read: async (path: string) => (path.endsWith(".env") ? "" : probe.read(path)),
		},
	});
	assert.ok(result.missing.includes("SCORM_CLOUD_APP_ID"));
	assert.ok(result.missing.includes("SCORM_CLOUD_SECRET_KEY"));
});
