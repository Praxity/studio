import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

// No skip or fallback: a runtime upgrade that drops SQLite or EXCLUSIVE locking
// must fail the gate. Run this contract on every supported Node upgrade.
test("shipped SQLite excludes another process on an empty file and releases on close", () => {
	const directory = mkdtempSync(join(tmpdir(), "studio-sqlite-contract-"));
	const path = join(directory, "lock.sqlite");
	const contender = `
const { DatabaseSync } = require('node:sqlite');
const database = new DatabaseSync(process.argv[1], { timeout: 0 });
try {
  database.exec('BEGIN EXCLUSIVE');
  console.log('acquired');
} catch (error) {
  if ((error.errcode & 0xff) !== 5) throw error;
  console.log('busy');
} finally { database.close(); }
`;
	let database;
	try {
		database = new DatabaseSync(path, { timeout: 0 });
		database.exec("BEGIN EXCLUSIVE");
		assert.equal(database.isTransaction, true, "BEGIN EXCLUSIVE must start a transaction");
		const run = () =>
			execFileSync(process.execPath, ["-e", contender, path], { encoding: "utf8" }).trim();
		assert.equal(run(), "busy", "BEGIN EXCLUSIVE must exclude a second process");
		database.close();
		database = undefined;
		assert.equal(run(), "acquired", "close must release the OS lock");
		assert.equal(statSync(path).size, 0, "lock transactions must not write database bytes");
	} finally {
		database?.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
