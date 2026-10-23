import { type LegacyMode, resolveLegacyFixture } from "./legacy-store-fixture.ts";

process.stdout.write(JSON.stringify(resolveLegacyFixture(process.argv[2] as LegacyMode)));
