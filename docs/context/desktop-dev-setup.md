# Studio CLI development

The Electron application is retired. Build the supported standalone CLI with:

```sh
pnpm install --frozen-lockfile
pnpm build:cli
node dist/studio-cli/praxity.mjs studio <course-directory> --no-open
```

Open the printed ready URL. `/` enters Read mode on the learner origin. Edit text returns through launch admission to the author document. Use `pnpm test:affected` for selected checks and `pnpm test:cli` to verify the built artifact. Browser journeys use `PRAXITY_BROWSER_ARTIFACT` with the artifact directory; see [testing strategy](testing-strategy.md). The previous desktop release remains at tag `v0.3.0`.
