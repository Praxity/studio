/** Local PCM silence for playback-state checks. Keep short clips for natural-end checks. */
export function silentWav(durationSeconds: number): Buffer {
	if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
		throw new Error("Silent audio duration must be a positive integer number of seconds");
	}
	const sampleRate = 8_000;
	const audio = Buffer.alloc(44 + durationSeconds * sampleRate * 2);
	audio.write("RIFF", 0);
	audio.writeUInt32LE(audio.length - 8, 4);
	audio.write("WAVEfmt ", 8);
	audio.writeUInt32LE(16, 16);
	audio.writeUInt16LE(1, 20);
	audio.writeUInt16LE(1, 22);
	audio.writeUInt32LE(sampleRate, 24);
	audio.writeUInt32LE(sampleRate * 2, 28);
	audio.writeUInt16LE(2, 32);
	audio.writeUInt16LE(16, 34);
	audio.write("data", 36);
	audio.writeUInt32LE(audio.length - 44, 40);
	return audio;
}
