/** Nine alternating black/white 1px frames; delay is in hundredths of a second. */
export function signalGif(delay: number): Uint8Array {
	const bytes = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255];
	for (let i = 0; i < 9; i++)
		bytes.push(
			33,
			249,
			4,
			0,
			delay,
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
