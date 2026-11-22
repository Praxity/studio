export const STANDALONE_NODE_RANGE = ">=24.22.1 <27";

export function supportsStandaloneNode(version: string): boolean {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) return false;
	const current = match.slice(1).map(Number);
	const [minimum, maximum] = STANDALONE_NODE_RANGE.split(" ");
	const lower = minimum.slice(2).split(".").map(Number);
	const difference = current.findIndex((part, index) => part !== lower[index]);
	return (
		current[0] % 2 === 0 &&
		current[0] < Number(maximum.slice(1)) &&
		(difference === -1 || current[difference] > lower[difference])
	);
}
