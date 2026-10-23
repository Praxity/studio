/** Resolve against the LMS each time: other document adapters can append objectives. */
export function writeObjectiveId(
	id: string,
	read: (element: string) => string | null,
	write: (element: string, value: string) => boolean,
): number | undefined {
	const rawCount = read("cmi.objectives._count");
	if (rawCount === null || !/^\d+$/.test(rawCount)) return;
	const count = Number(rawCount);
	if (!Number.isSafeInteger(count)) return;
	const indices = new Map<string, number>();
	for (let n = 0; n < count; n++) {
		const savedId = read(`cmi.objectives.${n}.id`);
		// An unknown slot could own this id. Never guess and overwrite another group.
		if (!savedId) return;
		if (!indices.has(savedId)) indices.set(savedId, n);
	}
	const n = indices.get(id) ?? count;
	if (write(`cmi.objectives.${n}.id`, id)) return n;
}
