// Inject an OS rename refusal in a child, outside the store's flush seam.
const fs = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");
const { basename } = require("node:path");
const rename = fs.rename;
fs.rename = async (source, target) => {
	if (basename(String(target)) === "comments.json")
		throw Object.assign(new Error("Injected rename refusal"), { code: process.argv[4] });
	return rename(source, target);
};
syncBuiltinESMExports();
