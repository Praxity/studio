import { narrationConfigureSchema } from "../../shared/ipc-schemas";

export function studioNarrationStatus(environment: NodeJS.ProcessEnv) {
	return {
		configured: Boolean(environment.SONIOX_API_KEY?.trim()),
		region: narrationConfigureSchema.shape.region.parse(environment.SONIOX_REGION ?? "eu"),
		disclosureRequired: true,
	};
}
