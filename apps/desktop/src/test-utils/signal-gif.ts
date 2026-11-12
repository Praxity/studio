/** Nine alternating black/white 1px frames; delay is in hundredths of a second. */
export function signalGif(
	delay: number | readonly number[],
	options: { frames?: number; loop?: number } = {},
): Uint8Array {
	const bytes = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255];
	if (options.loop !== undefined)
		bytes.push(
			33,
			255,
			11,
			...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)),
			3,
			1,
			options.loop & 255,
			options.loop >> 8,
			0,
		);
	for (let i = 0; i < (options.frames ?? 9); i++)
		bytes.push(
			33,
			249,
			4,
			0,
			Array.isArray(delay) ? delay[i] : (delay as number),
			0,
			0,
			0,
			44,
			0,
			0,
			0,
			0,
			1,
			0,
			1,
			0,
			0,
			2,
			2,
			i % 2 ? 76 : 68,
			1,
			0,
		);
	return Uint8Array.from([...bytes, 59]);
}
