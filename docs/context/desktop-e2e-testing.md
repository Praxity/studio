# Retired Electron tests

The Electron app and its QA/e2e launch paths are retired. The supported canvas and retained inspection tests run headlessly through `pnpm --filter @praxity/desktop e2e:browser-editor`. Set `PRAXITY_BROWSER_ARTIFACT` to test a standalone build. See [testing strategy](testing-strategy.md) for engine coverage and [browser editor](browser-editor.md) for retained security boundaries. Historical desktop behavior remains at tag `v0.3.0`.
