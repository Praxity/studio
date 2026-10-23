import { callbackify } from "node:util";

// Linux admission fixtures avoid thread-pool overhead; other hosts keep their native IO.
const synchronousAdmission = process.platform === "linux";

/** Path admission uses the native callback API as well as fs/promises. */
export function admissionNativeFilesystem(fs: typeof import("node:fs")) {
	if (!synchronousAdmission) return fs;
	return {
		...fs,
		realpath: Object.assign(
			callbackify(async (...args: Parameters<typeof fs.realpathSync>) => fs.realpathSync(...args)),
			{
				native: callbackify(async (...args: Parameters<typeof fs.realpathSync.native>) =>
					fs.realpathSync.native(...args),
				),
			},
		),
	};
}

/** Native synchronous calls avoid per-step thread-pool scheduling in admission tests.
 * Real bytes and handles remain; journal suites own flush/crash durability. */
export function admissionFilesystem(
	fs: typeof import("node:fs/promises"),
	nativeFs: typeof import("node:fs"),
) {
	if (!synchronousAdmission) return fs;
	return {
		...fs,
		realpath: async (...args: Parameters<typeof fs.realpath>) =>
			nativeFs.realpathSync.native(...args),
		lstat: async (...args: Parameters<typeof fs.lstat>) => nativeFs.lstatSync(...args),
		readdir: async (...args: Parameters<typeof fs.readdir>) => nativeFs.readdirSync(...args),
		mkdir: async (...args: Parameters<typeof fs.mkdir>) => nativeFs.mkdirSync(...args),
		chmod: async (...args: Parameters<typeof fs.chmod>) => nativeFs.chmodSync(...args),
		rm: async (...args: Parameters<typeof fs.rm>) => nativeFs.rmSync(...args),
		stat: async (...args: Parameters<typeof fs.stat>) => nativeFs.statSync(...args),
		unlink: async (...args: Parameters<typeof fs.unlink>) => nativeFs.unlinkSync(...args),
		rmdir: async (...args: Parameters<typeof fs.rmdir>) => nativeFs.rmdirSync(...args),
		link: async (...args: Parameters<typeof fs.link>) => nativeFs.linkSync(...args),
		rename: async (...args: Parameters<typeof fs.rename>) => nativeFs.renameSync(...args),
		open: async (...args: Parameters<typeof fs.open>) => {
			type Handle = Awaited<ReturnType<typeof fs.open>>;
			// Keep the complete native handle API for positioned reads, streams and closure.
			const handle = await fs.open(...args);
			return Object.assign(handle, {
				readFile: async (...options: Parameters<Handle["readFile"]>) =>
					nativeFs.readFileSync(handle.fd, ...options),
				writeFile: async (...options: Parameters<Handle["writeFile"]>) =>
					nativeFs.writeFileSync(handle.fd, ...options),
				stat: async (...options: Parameters<Handle["stat"]>) =>
					nativeFs.fstatSync(handle.fd, ...options),
				sync: async () => {},
			});
		},
	};
}
