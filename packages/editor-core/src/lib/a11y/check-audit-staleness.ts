import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKER_PATH = resolve(__dirname, "audit-tracker.json");
const REPO_ROOT = resolve(__dirname, "../../../..");
const SHARED_BLOCKS_DIR = resolve(REPO_ROOT, "packages/shared-blocks/src/blocks");

interface AuditEntry {
	lastAuditDate: string;
	lastModifiedCommit: string;
	wcagCriteriaCovered: string[];
}

function capitalizeFirst(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

async function main() {
	const tracker = JSON.parse(readFileSync(TRACKER_PATH, "utf-8"));
	const blocks: Record<string, AuditEntry> = tracker.blocks;

	const staleBlocks: Array<{
		block: string;
		auditDate: string;
		lastModified: string;
	}> = [];

	for (const [blockType, entry] of Object.entries(blocks)) {
		const auditDate = entry.lastAuditDate;

		// Validate date format to prevent argument injection via JSON values
		if (!/^\d{4}-\d{2}-\d{2}$/.test(auditDate)) {
			console.error(`  ⚠ Invalid audit date for ${blockType}: ${auditDate}`);
			continue;
		}

		try {
			const { stdout: sharedLog } = await execFileAsync(
				"git",
				[
					"log",
					`--since=${auditDate}`,
					"--oneline",
					"--",
					`${SHARED_BLOCKS_DIR}/*${blockType}*`,
					`${SHARED_BLOCKS_DIR}/*${capitalizeFirst(blockType)}*`,
				],
				{ cwd: REPO_ROOT },
			);

			const trimmedShared = sharedLog.trim();

			if (trimmedShared) {
				const lastCommit = trimmedShared.split("\n")[0];
				staleBlocks.push({
					block: blockType,
					auditDate,
					lastModified: lastCommit,
				});
			}
		} catch {
			// git command failed — skip
		}
	}

	if (staleBlocks.length === 0) {
		console.log("✓ All block audits are current. No blocks modified since their last audit.");
	} else {
		console.log(`⚠ ${staleBlocks.length} block(s) modified since last audit:\n`);
		for (const b of staleBlocks) {
			console.log(`  ${b.block} (audited: ${b.auditDate})`);
			console.log(`    Last change: ${b.lastModified}\n`);
		}
	}
}

main();
