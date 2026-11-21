# Course-help Worker

This Cloudflare Worker stores learner questions for the optional help button in standalone
HTML exports. A learner asks the course team a question about the page they are on, and can
quote selected text or a part of the page they point at. Each thread is private to that learner
and the course team. Staff answer from a plain HTML page served by the same Worker. The learner
sees a reply, with an unread count on the button, the next time they open a course page. There is
no live push and no email.

SCORM, xAPI, review builds and Studio preview never include the button. An LMS page can't prove to a separate
server who the learner is. The Worker relies on Cloudflare Access for identity instead.

## Turn it on in a course

Add `help` to `course.yaml` and export HTML:

```yaml
help:
  endpoint: help/
  label: Ask a tutor
  intro: Ask about anything on this page. A tutor replies within one working day.
```

- `endpoint` (required) is the Worker's base URL: a relative URL or an absolute HTTPS URL, checked
  like `courseHomeUrl`. Relative URLs resolve from the exported page. Queries and fragments are
  dropped.
- `label` (optional) replaces the button and panel title, "Ask the course team".
- `intro` (optional) replaces the panel's opening sentence.

The defaults follow the course `locale` (English or French). The `label` and `intro` you write
are shown as written.

Each exported page then loads `course-help.js`, which adds its own `course-help.css`. Without
`help`, the export has neither file and no script tag.

## Deploy

The simplest setup serves the course and the Worker from one hostname behind one Access
application, with the Worker on a route such as `courses.example.org/safety/help/*` and the
course files beside it. Then `endpoint: help/` works without CORS.

1. Create the database and apply the schema, from `packages/course-help`:

   ```sh
   wrangler login
   wrangler d1 create praxity-course-help
   wrangler d1 migrations apply praxity-course-help --remote
   ```

   Put the printed `database_id` in `wrangler.toml` in your local copy. Don't commit it.

2. In Cloudflare Zero Trust, create a self-hosted Access application covering the course and the
   Worker route. Add a policy that admits your learners and staff. Copy the application's
   audience (AUD) tag.

3. Set the variables in `wrangler.toml`:

   - `ACCESS_TEAM_DOMAIN`: your team domain, such as `your-team.cloudflareaccess.com`.
   - `ACCESS_AUD`: the AUD tag from step 2.
   - `STAFF_EMAILS`: comma-separated addresses of the people who answer questions. They sign in
     through the same Access application.
   - `STAFF_LOCALE`: `en` or `fr`, for the staff page.

4. Add the route and deploy: `wrangler deploy`.

### Course on another origin

If the course is hosted somewhere else, set `endpoint` to the Worker's absolute HTTPS URL and
list the course origin, such as `https://learn.example.net`, in `COURSE_ORIGINS`. The Worker then
answers that origin with credentialed CORS and refuses all other origins. Never list `null`: it is
the origin of `file://` pages and sandboxed frames on any site, and the Worker refuses it. In the Access
application's CORS settings, allow that origin with credentials and let `OPTIONS` requests
through, because browsers send preflights without cookies. Learners must already have an Access
session for the Worker's hostname; otherwise the panel says it can't load their questions.

## Answer questions

Staff open `<Worker base>/staff`, for example `https://courses.example.org/safety/help/staff`.
Threads waiting for a reply come first. Each has the learner's email, the page title, any quoted
text, the conversation so far and a reply form. A learner who isn't in `STAFF_EMAILS` gets 403.

## Identity and limits

- Every request needs a valid Access JWT in `Cf-Access-Jwt-Assertion`. The Worker checks the
  RS256 signature against the team's published keys, the issuer, the audience, expiry and
  not-before. It refuses tokens without an email, such as service tokens.
- Threads belong to the token's `sub`, the stable Access user ID. A learner can read and reply
  only to their own threads.
- Staff are decided by the token's email, so the Access identity provider must assert verified
  email addresses (one-time PIN and Google do). Learners and staff share the Access application.
- A learner can send 10 messages (questions and replies together) per minute and 100 per day.
  The counts and the insert are one statement in D1.
- The staff page shows every thread waiting for a reply plus the 200 newest threads.
- Request bodies are limited to 16 KiB. Fields: page ID 200 characters, page title 200,
  quote 300, message 2,000.

## HTTP protocol

Paths are relative to the endpoint. The Worker matches the end of the path, so it works under
any route prefix. Learner requests send and receive JSON; writes need
`Content-Type: application/json`.

| Request | Body | Success |
|---|---|---|
| `GET threads` | none | 200 with the learner view |
| `POST threads` | `{ "pageId", "pageTitle"?, "quote"?, "body" }` | 201 with the learner view |
| `POST threads/{id}/replies` | `{ "body" }` | 201 with the learner view |
| `POST read` | `{}` | 200 with the learner view; marks staff replies read |
| `GET staff` | none | 200 HTML staff page (staff only) |
| `POST staff/threads/{id}/replies` | form field `body` | 303 back to the staff page (staff only, same origin) |

The learner view is `{ "threads": Thread[], "unread": number }`. Threads are newest first:

```json
{
	"id": 1,
	"pageId": "01JD0000000000000000000000",
	"pageTitle": "Lifting safely",
	"quote": "Keep the load close",
	"body": "How close is close?",
	"createdAt": "2026-11-20T10:00:00.000Z",
	"replies": [
		{ "id": 2, "body": "Touching your body.", "fromStaff": true, "read": false, "createdAt": "2026-11-20T11:00:00.000Z" }
	]
}
```

Errors return `{ "error": code }`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid` | Malformed JSON, a missing or empty field, or an unknown field |
| 401 | `unauthenticated` | Missing or invalid Access token |
| 403 | `forbidden` | Origin not allowed, or a non-staff request to a staff route |
| 404 | `not_found` | Unknown path, or a thread that isn't the learner's |
| 413 | `too_large` | Body over 16 KiB or a field over its limit |
| 415 | `unsupported_media_type` | Wrong `Content-Type` |
| 429 | `rate_limited` | Over 10 messages a minute; `Retry-After: 60` |
| 503 | `unavailable` | Access keys couldn't be fetched |

## Tests

`pnpm --filter @praxity/course-help test` runs the Worker against the real schema on
`node:sqlite`, with tokens signed by a test key.
