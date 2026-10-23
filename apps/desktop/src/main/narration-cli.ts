import { resolve } from "node:path";
import { NARRATION_ROLES, type NarrationTarget } from "@praxity/shared-blocks/narration";
import { isIdentityNodeId } from "@praxity/shared-blocks/types";
import type { CliExecution } from "./cli";
import en from "./cli-messages/en.json" with { type: "json" };
import fr from "./cli-messages/fr.json" with { type: "json" };

export const narrationHelp = `  praxity narration status [<project-dir>]
  praxity narration accept <uuid:role> [--project <project-dir>]
  praxity narration attach <uuid:role> <assets/path> [--project <project-dir>]`;

export async function runNarrationCli(args: string[]): Promise<CliExecution> {
	const action = args[1];
	let root = process.cwd();
	const positional = args.slice(2);
	const projectIndex = positional.indexOf("--project");
	if (projectIndex >= 0) {
		if (projectIndex !== positional.length - 2 || !positional[projectIndex + 1]) return invalid();
		root = positional[projectIndex + 1];
		positional.splice(projectIndex, 2);
	}
	if (action === "status") {
		if (positional.length > 1 || positional[0]?.startsWith("-")) return invalid();
		root = positional[0] ?? root;
	} else if (
		(action !== "accept" && action !== "attach") ||
		positional.length !== (action === "attach" ? 2 : 1)
	)
		return invalid();
	let target: NarrationTarget | undefined;
	if (action !== "status") {
		const parts = positional[0].split(":");
		if (parts.length !== 2) return invalid();
		const [id, role] = parts;
		if (!isIdentityNodeId(id) || !(NARRATION_ROLES as readonly string[]).includes(role))
			return invalid();
		target = { id, role: role as NarrationTarget["role"] };
	}
	if (action !== "status" && !target) return invalid();
	try {
		const { changeNarrationTarget, narrationAuthoringStatus } = await import(
			"./narration-authoring"
		);
		const result =
			action === "status"
				? await narrationAuthoringStatus(resolve(root))
				: await changeNarrationTarget(
						resolve(root),
						target as NarrationTarget,
						action as "accept" | "attach",
						positional[1],
					);
		return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${en.narration.failed}\n${fr.narration.failed}\n${reason}\n`,
		};
	}
}
function invalid(): CliExecution {
	return {
		exitCode: 2,
		stdout: "",
		stderr: `${en.narration.usage}\n${fr.narration.usage}\n${narrationHelp}\n`,
	};
}
