# Embed fallback

Settled 2026-10-07. Native iframe load events also fire after failed navigation.
Cross-origin Resource Timing can hide the same fields on successful responses.
Neither signal proves a provider rendered. See [MDN's iframe event guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior).

The iframe gets three seconds in view to confirm through a message from its
current window and exact source origin. CSP and error events select the fallback
immediately. Without confirmation, the source link, URL and a "Show embedded
content" control replace the frame. That control restores the frame without a
second deadline and moves focus into it. Providers without messaging therefore
need this explicit recovery. A local video facade remains visible before playback.

Rejected: treating load as success, treating opaque timing zeros as failure,
and permanently hiding an unconfirmed provider. The browser regressions exercise
aborted navigation, fallback height, recovery focus and a confirming provider.
These checks establish browser behavior, not spoken screen-reader output.
