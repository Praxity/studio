import { homedir } from "node:os";

export function portablePath(file) {
	return file.replaceAll("\\", "/");
}

export function assertNoPrivateCheckoutPath(bytes, relative, repoDir) {
	const homeDir = process.env.HOME || homedir();
	for (const privatePath of [repoDir, homeDir]) {
		if (
			bytes.includes(Buffer.from(privatePath)) ||
			bytes.includes(Buffer.from(portablePath(privatePath)))
		) {
			throw new Error(`Private checkout path in artifact: ${relative}`);
		}
	}
}
