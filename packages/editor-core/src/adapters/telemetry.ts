export interface TelemetryAdapter {
	trackEvent(name: string, properties?: Record<string, unknown>): void;
	reportError(error: Error, context?: Record<string, unknown>): void;
	shutdown(): Promise<void>;
}
