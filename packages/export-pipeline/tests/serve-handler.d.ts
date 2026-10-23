declare module "serve-handler" {
	import type { IncomingMessage, ServerResponse } from "node:http";

	interface ServeHandlerOptions {
		public?: string;
		cleanUrls?: boolean;
	}

	export default function handler(
		request: IncomingMessage,
		response: ServerResponse,
		options?: ServeHandlerOptions,
	): Promise<void>;
}
