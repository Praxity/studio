# Published disclosure decisions

P27, October 2026. The owner approved custom buttons for published disclosures in
`f730a1bc`. This is a product default, not a finding against native HTML.

The server renders a plain heading label and visible panel with a prepared hidden
button. Enhancement installs its handler, moves the single label node into the
button, exposes the working control and collapses the panel unless its content
already has focus. The button exposes synchronized `aria-expanded`
and `aria-controls`. Keeping one label node preserves authored IDs and inline
graphics. Initial fragments and fragment changes reveal matching panels.

Rejected: rendering the rich label in both the fallback and button duplicated
authored IDs and sent fragment navigation to the hidden copy. Moving one node
preserves its identity.

Rejected: revealing fragments only in the accordion island left transcript
content anchors hidden. Fragment reveal belongs to the shared disclosure enhancer.

Panel collapse uses display styling. `[hidden]` represents authored concealment
to the required-activity gate; collapsing a disclosure must preserve eligibility.
Print CSS expands panels without changing screen state.

Native heading elements retain the previous label typography. The reset must
outrank the course's global heading-size selectors; browser regressions compare
the button and panel font size, family and line height. The existing inset focus
ring remains on the button, and its centered state graphic is decorative.

Evidence: renderer and island regressions, published Chromium, WebKit and Firefox
keyboard, fallback and print checks. Current screen-reader speech remains untested.
See [APG accordion](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) and
[APG disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).
