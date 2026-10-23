// Pause at the filesystem boundary after T1 has admitted a read without a lock.
const fs = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");
const readdir = fs.readdir;
let stalled = false;
let armed = process.argv[2] === "first-use";
process.on("message", (message) => {
	if (message === "arm-cold-read") armed = true;
});
fs.readdir = async (...args) => {
	if (armed && !stalled && String(args[0]) === process.argv[3]) {
		stalled = true;
		const resumed = new Promise((resolve) => process.once("message", resolve));
		process.send("cold-read-stalled");
		await resumed;
	}
	return readdir(...args);
};
syncBuiltinESMExports();
