/** Resolve the count copy shared by baseline and interactive presentation. */
export function formatCount(copy: { count: string }, n: number, max: number): string {
	return copy.count.replaceAll("{n}", String(n)).replaceAll("{max}", String(max));
}
