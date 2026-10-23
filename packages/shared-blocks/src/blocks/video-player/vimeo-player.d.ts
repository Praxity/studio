declare module "@vimeo/player" {
	export default class Player {
		constructor(element: HTMLIFrameElement | HTMLElement, options?: Record<string, unknown>);
		play(): Promise<void>;
		pause(): Promise<void>;
		setCurrentTime(seconds: number): Promise<number>;
		getCurrentTime(): Promise<number>;
		getDuration(): Promise<number>;
		on(event: string, callback: (...args: unknown[]) => void): void;
		off(event: string, callback?: (...args: unknown[]) => void): void;
		destroy(): void;
	}
}
