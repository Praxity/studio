# PostHog analytics queries

Use the root `.env` values `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, and
`POSTHOG_ADMIN_API_KEY` for manual HogQL queries. Keep their values out of logs,
commits, and chat output. The desktop capture and source-map keys in
`apps/desktop/.env` are for the application and release build, not analytics
queries.

Event names and properties live in
`apps/desktop/src/main/telemetry-catalog.md`. Query the project through PostHog's
HogQL endpoint:

```bash
set -a
source .env
set +a

curl --fail-with-body --silent --show-error \
  "$POSTHOG_HOST/api/projects/$POSTHOG_PROJECT_ID/query/" \
  -H "Authorization: Bearer $POSTHOG_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"query":{"kind":"HogQLQuery","query":"SELECT event, count() FROM events GROUP BY event ORDER BY count() DESC LIMIT 50"}}'
```

Use `SELECT` queries unless the user explicitly requests a PostHog mutation.
