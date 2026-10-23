# Accessibility checklist for Praxity Studio

Use this checklist when you change editor UI, published output, or shared blocks. Check each change against WCAG and against the Praxity defaults in `/a11y` §5. Report a missing default as an advisory finding under §6, with severity set by its effect on users.

Sources: [A11Y Project](https://www.a11yproject.com/checklist/), [WebAIM](https://webaim.org/), [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/), [WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/), [Jacob Wood's good and bad demos](https://www.jacobwood.me/demos/good_example.html).

---

## Document basics

- [ ] **`<html lang="en">`, or the page's actual language.** Screen readers use it to pick the pronunciation engine. A missing `lang` garbles speech for the entire page. Content in a language other than the page default needs its own `lang` attribute on the element that contains it.
- [ ] **Descriptive `<title>` per page.** "Web Page" tells the user nothing. Name the view, the course, and "Praxity Studio", in that order, joined with the product's title separator. Update `document.title` on every SPA route change. The title is the first thing a screen reader announces on page load.
- [ ] **No duplicate `id` attributes.** Duplicate IDs break `aria-labelledby`, `aria-describedby`, `aria-controls`, and `<label for>`, because each reference finds only the first element with that ID. Grep for duplicate IDs when reusing components.
- [ ] **Viewport allows zoom.** `<meta name="viewport">` must not set `maximum-scale=1` or `user-scalable=no`. Low-vision users need to zoom.
- [ ] **Device-neutral verbs in all user-facing copy.** Write "select", not "click", "tap", "swipe", or "hover". Device-dependent verbs exclude keyboard, touch, switch and voice users. This applies to UI strings, error messages, instructions and learner content.

---

## Landmarks

- [ ] **One `<main>` per page/view.** Put all primary content inside it.
- [ ] **Navigation landmarks outside `<main>`.** Make `<nav>` elements sibling landmarks so screen reader landmark navigation finds each one on its own (the `D` key in NVDA, the rotor in VoiceOver).
- [ ] **Review repeated landmark names under `/a11y` §5.** Prefer names taken from visible text where they fit.
- [ ] **Review singleton landmark names under `/a11y` §5.**
- [ ] **Prefer semantic HTML over ARIA roles.** Use `<nav>`, `<main>`, `<aside>`, `<header>`, and `<footer>`. Add `role` attributes only to fill a browser or AT support gap. Never repeat native semantics; `<nav role="navigation">` is redundant.
- [ ] **Editor landmark structure:** banner (header) → complementary "Course outline" (aside) → main (canvas) → complementary "Editor tools" (aside) → toolbar (bottom bar).
- [ ] **Published Pages landmark structure:** navigation "Course navigation" contains the "Course pages" labelled group; main contains page content, with "Page navigation" controls where enabled.
- [ ] **Published Guided slides:** verify the course outline, slide content and course controls separately; do not apply the Pages sidebar structure to the deck.

## Headings

- [ ] **Give each page a clear primary heading.** One `<h1>` per page is a Praxity default (P09 in `/a11y` §5); WCAG does not require exactly one. Browsers never implemented the document outline algorithm, in which sectioning elements set implicit heading levels.
- [ ] **Prefer a logical, nested heading hierarchy.** Avoid skipped levels that misrepresent the structure, but do not report a skip by itself as a WCAG failure. Published output uses `headingOffset` to keep author-created headings in order below the page's generated title.
- [ ] **Choose level by hierarchy, not visual size.** Style headings with CSS. Do not pick `<h3>` because it "looks right".
- [ ] **Never exceed heading level 6.** JAWS falls back to level 2 for higher levels. TalkBack announces no level (Firefox) or falls back to level 2 (Chrome). Narrator drops headings above 9 entirely. Only NVDA handles arbitrary levels.
- [ ] **Use native `<h1>`–`<h6>`, not `role="heading"` + `aria-level`.** Native elements have better cross-browser and AT support. If `role="heading"` is unavoidable, always set `aria-level`, because browser defaults vary widely.
- [ ] **Text styled as a heading must use heading markup.** Text that looks like a heading (large, bold, different font) but uses `<div>`, `<span>`, or `<p>` fails WCAG 1.3.1.
- [ ] **Empty headings are a WCAG failure.** `<h2></h2>` fails 1.3.1. Remove the heading or give it text.
- [ ] **Subtitles and taglines use `<p>`, not heading elements.** Use `<hgroup>` with `<h#>` + `<p>` children for the subtitle pattern.
- [ ] **sr-only headings for panels and sections.** Give the sidebar, right panel, and other non-content sections a visually hidden `<h2>` so heading navigation (the `H` key) reaches them.
- [ ] **82% of screen reader users navigate by headings** (WebAIM survey). Heading structure is the main way they learn the page layout.

## Semantic HTML

Screen readers have quick-navigation keys for semantic elements. Fake semantics, such as styled `<div>` or `<p>` elements that only look like headings, lists, or tables, are invisible to those keys and leave screen reader users unable to navigate the content. [Jacob Wood's bad example](https://www.jacobwood.me/demos/bad_example.html#structure) shows what this looks like.

- [ ] **Real headings, not styled paragraphs.** The `H` key cannot reach `<p class="fake-h2">`. Use `<h2>` and style it with CSS. If text that looks like a heading should stay out of the heading outline, it is not a heading. Use a styled `<p>` with no heading role.
- [ ] **Real lists, not text separated by line breaks.** The `L` key (jump to list) and `I` key (jump to list item) cannot reach `- Item<br>- Item<br>`. Use `<ul>` or `<ol>` with `<li>` children. Never fake a list with `<br>`, with `<p>` tags holding bullet characters, or with `<div>` elements.
- [ ] **Real tables, not div grids.** The `T` key (jump to table) and `Ctrl+Alt+Arrow` keys (move between cells) cannot navigate a `<div>` styled as a table grid. Use `<table>` with the right headers and cells. Add a caption or other name when context does not already identify the table.
- [ ] **`<blockquote>` for quotations.** NVDA and JAWS announce blockquote boundaries; Narrator, VoiceOver, and TalkBack do not. Use `<footer>` + `<cite>` for attribution inside the blockquote. Never wrap it in `<figure>`/`<figcaption>`, which makes it too verbose. Never use the `cite` attribute on `<blockquote>`, because JAWS reads the full URL aloud.
- [ ] **`<figure>` and `<figcaption>` for captioned images.** They associate the caption with the image programmatically. The figcaption adds context that `alt` text alone cannot.
- [ ] **Use native `<dialog>` for modals before adopting the popover API.** `<div role="dialog">` breaks around popovers. Popovers render in the top layer, where they can cover a non-native dialog and capture its keyboard events. Pressing Escape on a popover can also close the dialog underneath it.
- [ ] **Wrap meaningful emoji in `<span role="img" aria-label="...">`.** Browsers may not expose bare emoji in the accessibility tree. Give decorative emoji `aria-hidden="true"`. Avoid emoji in instructional text.
- [ ] **Use `text-transform: uppercase` instead of hardcoded all-caps.** Screen readers do not announce capitalization. Write normal case in HTML and set the case in CSS.
- [ ] **Use CSS `::first-letter` for drop caps, not extra HTML.** Splitting letters into separate elements breaks the screen reader's reading flow. Never use `role="text"`, which is not a valid ARIA role.
- [ ] **Use semantic `<sup>`/`<sub>`, not CSS `vertical-align`.** Most screen readers ignore superscript and subscript by default. Where meaning depends on them (formulas, footnotes), add visually hidden fallback text.
- [ ] **Prefer `overflow-wrap: anywhere` for breaking long words.** Screen readers ignore it. Use `<wbr>` for URLs and code. Avoid `word-break: break-all`. Set `lang` when using `hyphens: auto`.

## Links

- [ ] **Descriptive link text.** Every link's purpose must be clear from its text alone or from its immediate context. Screen reader users can open a list of all links on the page, where "Click Here" and "Read More" mean nothing.
- [ ] **Never use "Click Here", "Read More", or "Learn More" as standalone link text.** Write text such as "View SCORM export documentation", "Read the Deque Systems Blog", or "Open [Course Title]".
- [ ] **Links must go somewhere.** `<a href="javascript:void(0)">` is a broken pattern, not a link. If the element performs an action, use a `<button>`. If it navigates, give it a real `href`.
- [ ] **Say when a link opens a new tab.** Links to external resources in a course open in a new tab and say so in their visible text and accessible name, as the product's "(opens in new tab)" string does (P12 in `/a11y` §5). Any other link that opens a new tab gives the same warning. A missing warning is an advisory finding, not a WCAG AA failure. It matters most when the user would lose track of where the link went or how to get back.
- [ ] **Distinguish links from surrounding text.** Links in body text must look different from the text around them without relying on color alone. Underline is the most reliable method. Without underline, links need 3:1 contrast against surrounding text AND a non-color change on hover and focus.
- [ ] **Never add `role="button"` to `<a>` elements.** The Space key still scrolls the page instead of activating the element. Use `<button>` for actions.
- [ ] **Never use `aria-label` on links with visible text.** It overrides the visible name, so voice control users cannot activate the link by saying its visible text (WCAG 2.5.3). Put visually hidden text inside the link instead.
- [ ] **Never put `aria-hidden="true"` inside links.** Browser text-to-speech features (Edge Read Aloud, Chrome Reader Mode) respect `aria-hidden` but ignore `aria-label`, so the link goes silent.
- [ ] **Use `aria-current="page"` for active navigation items.** Style them with the `a[aria-current="page"]` CSS selector so the visual and programmatic state stay in sync.

## Cards and clickable regions

- [ ] **Never wrap an entire card in a single `<a>` or `<button>`.** It produces a ~25s screen reader announcement, destroys heading semantics, blocks text selection, and defeats voice control.
- [ ] **The primary link wraps only the heading.** Use `<h3><a href="...">Title</a></h3>`, not `<a><h3>Title</h3><p>Description</p></a>`.
- [ ] **Expand the clickable area with an `::after` stretch or a redundant JS click.** Use `::after` for single-action cards, and JS with a `getSelection()` guard for cards with secondary actions.
- [ ] **Secondary actions (edit, delete, duplicate) are separate `<button>` elements.** Give each one `aria-label="[Action] [Card Title]"` for context.
- [ ] **Never wrap `<figure>` in `<a>`.** TalkBack with Chrome falls back to the URL, and the figure contents become unreachable.
- [ ] **Never use "Read more" as standalone link text.** Screen reader link lists cannot tell these links apart. VoiceOver's rotor and the JAWS links dialog do not show `aria-describedby`.

## Disclosure and accordion

- [ ] **Choose disclosure markup by P27 in `/a11y` §5.** This covers FAQ answers, transcripts, supplementary information and image descriptions. Check the enhanced control and the readable fallback separately.
- [ ] **For accordions, wrap the set in `<section role="group" aria-labelledby="...">`.** ARIA has no `accordion` role. The group takes its accessible name from a heading.
- [ ] **The heading wraps the control, never the reverse.** Use `<h3><button aria-expanded aria-controls>`. That keeps the heading level and the accessible name separate, and heading navigation reaches every section. H-key navigation, which most screen reader users rely on to move through a page, skips a trigger that is not inside a heading.
- [ ] **Keep headings out of `<summary>`.** HTML allows them, but screen readers expose them inconsistently. In a custom accordion, put each button inside a heading.
- [ ] **`role="region"` on panels is optional and scales badly.** APG permits it. Avoid it when more than about six panels can be open at once, because each panel becomes a landmark and fills the rotor with entries that are not real jump targets. `aria-controls` on the trigger already relates the trigger to its panel. If a component library hardcodes `role="region"` on panels, override it.
- [ ] **Give every trigger a visible state cue.** On a custom disclosure, use an `aria-hidden` chevron that follows `aria-expanded`. On a native disclosure that P27 allows, keep a visible marker that follows `open`, and test any replacement marker with screen readers.
- [ ] **The trigger must look like the heading level it is.** Sighted users read an `<h3>` styled down to caption size as "not a heading", even when the markup is right. People then report a semantics bug when the bug is in the styling.
- [ ] **Put each panel straight after its trigger, or after the heading that holds the trigger.** That keeps reading and focus order intact. Once enhanced, the panel shows and hides with the button's expanded state. The fallback stays readable, as P27 requires.
- [ ] **Leave focus on the trigger when content opens.** Let users move forward into the disclosed content themselves.
- [ ] **Use semantics that match the disclosure.** Links imply navigation. Native checkboxes, radios, and `<details>` keep their semantics when styled with CSS, but they must not look like a different widget. Custom disclosure buttons need `aria-expanded` and keyboard behavior.
- [ ] **Say whether an accordion is single-open or multi-open when the difference matters.** Either is allowed. interaction-designer sets the multi-open default.
- [ ] **Handle print.** Open all panels on `beforeprint` and restore them on `afterprint`.

## Forms

- [ ] **Every input has a `<label for="id">`.** Explicit association through `for`/`id` has broader assistive technology support than a label wrapped around the input. A screen reader user who tabs to an unlabeled input hears only "edit text" and has no idea what to type.
- [ ] **Prefer a `<div>` + sibling `<label for>` over a `<label>` wrapping both the input and its text.** HTML permits both, and they mean the same thing. A wrapping label has regressed in WebKit more than once. VoiceOver then exposes the text twice, once as the input's computed name on focus and again as flow text during continuous reading (WebKit bugs 279256, 230824). This is a workaround for specific versions, not a spec requirement. Verify against the shipping engine instead of assuming either shape is safe.
- [ ] **Never use `placeholder` as the only label.** Placeholders disappear when users start typing, have too little contrast by default, and not every screen reader announces them. A `<label>` is always required; `placeholder` only supplements it.
- [ ] **Group related inputs with `<fieldset>` and `<legend>`.** Do this for radio groups, checkbox groups, and address fields. Without `<fieldset>`, a screen reader announces each radio button in isolation, and the user does not know they are choosing from a set.
- [ ] **Radio buttons share the same `name` attribute.** Different `name` values (e.g., `name="option1"`, `name="option2"`) make each radio independent. Arrow keys do not move between them, and selecting one does not deselect the others.
- [ ] **Use the `required` attribute, not color alone.** A red asterisk or red label text is invisible to screen readers and to color-blind users. Use the HTML `required` attribute, which screen readers announce as "required", plus a visible indicator (an asterisk with a legend, or the word "required"). Hide decorative asterisks from screen readers with `aria-hidden="true"`.
- [ ] **Associate error messages through `aria-describedby`.** Link the error text to its input programmatically; placing it nearby is not enough. Do not use `aria-errormessage`, which fails in 4 of 6 tested screen reader and browser combinations.
- [ ] **Validate on `blur`, after the user has actually entered something.** Do not validate on every keystroke, or because the user tabbed past an empty field they never touched. Flagging a field before anyone had a chance to fill it in is hostile. Clear the error and `aria-invalid` as soon as a later `blur` passes.
- [ ] **Whether to announce an error depends on where focus is when it appears.** `aria-describedby` is always required. It is the association, and it re-reads the message when the user tabs back into the field later. It does not announce anything. With `blur` validation, focus has already left the field by the time the error renders, so nothing is spoken. In that case, wrap the message in `role="alert"` so screen readers announce it when it appears. The two attributes do different jobs and are not redundant. Never use `aria-live="assertive"` on an error that renders while focus is landing on the next field, because it cuts off that field's name.
- [ ] **Set `aria-invalid="true"` on fields with errors.** Screen readers then announce "invalid entry" on focus. Set it to `"false"` once the field is corrected. Never set it on page load, before the user has interacted.
- [ ] **Error elements exist in the DOM, hidden until needed.** Toggle the `hidden` attribute instead of creating and destroying elements, so `aria-describedby` always has a valid target.
- [ ] **Choose native or custom validation deliberately.** Native constraint validation is valid and often enough. Add `novalidate` only when the product has a tested custom flow that improves on it, and do not present `novalidate` as a conformance requirement.
- [ ] Choose read-only, unavailable, and display-only states using [Disabled controls](#disabled-controls).
- [ ] **Never use `aria-label` to change how a screen reader pronounces text.** Adding `aria-label="US Dollars"` to a button labeled "USD" violates WCAG 2.5.3 Label in Name, because voice control users can no longer activate it by saying "USD". It also breaks translation, overrides the user's screen reader dictionary, and disrupts character navigation. Accept the default pronunciation or use `<abbr>`.
- [ ] Review submit availability and explanations using [Disabled controls](#disabled-controls).
- [ ] **Use `<button>` elements for form actions, not `<div>` with `onclick`.** A `<div onclick>` cannot take keyboard focus, has no button role, and screen readers do not announce it as a button. Native `<button>` provides all of this.
- [ ] **Use native `<fieldset>` + `<legend>` for radio and checkbox groups.** `role="group"` + `aria-labelledby` fails on iOS VoiceOver and TalkBack. For styling freedom, pair a visually hidden legend with a visible duplicate marked `aria-hidden`. The legend text and the visible text must be identical (WCAG 2.5.3).
- [ ] **`<legend>` must be a direct child of `<fieldset>`.** Never wrap it in a `<div>`. Never give `<legend>` `display: contents`, which makes Safari remove it from the accessibility tree. Apply flex or grid to a wrapper `<div>` inside the `<fieldset>`, not to the `<fieldset>` itself.
- [ ] **Use only `click` handlers on native `<button>` elements.** `click` fires for mouse, keyboard (Enter + Space), touch, and voice. A separate `keydown` handler makes Enter activate the button twice.
- [ ] **Debounce destructive button actions.** Holding Enter repeats `keydown`, and screen readers repeat both keys. Guard delete, submit, and purchase actions against repeats.
- [ ] **Use native `<select>` over an ARIA listbox or combobox.** Custom selects lose the mobile dismiss gestures: TalkBack's back gesture and VoiceOver's scrub gesture navigate away instead of closing the listbox. Style native selects with `appearance: none` + `font: inherit; letter-spacing: inherit; word-spacing: inherit`.
- [ ] **Use grouped checkboxes for multi-select, not `<select multiple>`.** `<select multiple>` has tested poorly for 20+ years. Wrap the checkboxes in `<fieldset>`/`<legend>`, and put a skip link before long groups.
- [ ] **Use `<optgroup>` to group options in a select, not `<hr>`.** An `<hr>` inside `<select>` is purely visual, and no screen reader announces it. Android Chrome renders it as an empty option the user can select.
- [ ] **Use native `required` for native radio groups.** Radios with the same `name` form one group; `required` on any member requires one selection, not a check on every radio. Keep "(required)" visible in the `<legend>`. Use `aria-required` on a custom `radiogroup`, not as a replacement for native validation.
- [ ] **Conditional and dependent fields are DOM siblings of their trigger.** Show and hide them with CSS `:checked` and a sibling combinator; this needs no JS or ARIA. Leave focus where it is when dependent fields appear.
- [ ] Review custom read-only widget semantics and support using [Disabled controls](#disabled-controls).
- [ ] **Keep interaction instructions out of ARIA attributes.** Screen readers already announce how native widgets work, so text such as "Click to expand" or "Press Enter to submit" only repeats it. Write custom instructions only for new patterns with no ARIA equivalent.
- [ ] **Style each control through the state that drives it.** Custom widgets use their ARIA state, such as `[aria-expanded]` or `[aria-current]`. Native controls use native state, such as `details[open]`. Never add ARIA only to get a CSS selector.

## Disabled controls

First decide what state the control is really in. Then decide whether keyboard users need to find the unavailable control.

- [ ] Use native `disabled` on a supported control when users who skip past it can still understand its purpose and any explanation they need. Paired navigation controls that show a position count can meet this condition.
- [ ] Use `aria-disabled="true"` when users must be able to reach an unavailable control to learn about the action or why it is unavailable. Keep its normal Tab stop, or its place in the composite widget's navigation. A custom widget uses the ARIA state its role supports and follows its pattern's focus rules.
- [ ] Block every way to trigger an ARIA-disabled action: pointer, keyboard, assistive-technology activation, shortcuts, and form submission where it applies. Put the guard in the action itself. Native buttons normally send Enter and Space through their click handler.
- [ ] If the context does not already say why an action is unavailable, explain it. Keyboard and screen-reader users must be able to reach the explanation. Link any extra explanatory text with `aria-describedby`. A tooltip on a disabled control that cannot take focus is not enough.
- [ ] By default, keep submit enabled and show useful validation feedback when the user activates it. If the action must be unavailable, say why and what the user can do to enable it, and record the task evidence for the exception. An unavailable submit is not automatically a WCAG failure.
- [ ] Leave focus on a focusable ARIA-disabled control when it still gives the user a useful place, an explanation, or the status of an operation. If the focused control becomes natively disabled, hidden, or removed, move focus to a meaningful place. When a control that does not have focus changes state, focus stays where it is.
- [ ] Whether a disabled item in a composite widget stays focusable depends on the widget pattern and on whether users need to discover it. A disabled toolbar button does not have to remain an arrow-key stop.
- [ ] Show display-only values as plain text by default. Use native `readonly` on a supported control when the task needs an uneditable control whose value stays available or is submitted with the form. Explain the restriction on screen, and test the actual role with the AT combinations you support. A custom widget with a justified need can use `aria-readonly` where its role supports it. Use `disabled` only when the control is actually unavailable.
- [ ] Hide fields that do not apply until the user makes an earlier choice. When knowing that an unavailable choice exists helps the task, keep it visible with an accessible explanation.
- [ ] An unavailable link usually becomes explanatory text. HTML links do not support `disabled`. If you need an unavailable link that still takes focus, remove its live destination, keep its link semantics, set `aria-disabled`, and block navigation. Decide whether it stays in the focus order by whether users need to discover it.
- [ ] Make available and unavailable states look different. WCAG 1.4.3 and 1.4.11 exempt truly inactive components from their contrast thresholds. Explanatory text outside the control still has to meet the contrast requirement that applies to it.
- [ ] Keep unavailable controls readable; this is a Praxity default. Use readable text tokens, and mark the unavailable state with clear styling or an explanation. Test forced-colors mode. `GrayText` is one option, not a requirement everywhere. When the inactive-component contrast exemption applies, report a legibility barrier as an advisory finding.
- [ ] For Mantine controls, inspect the resulting semantics, focus behavior, and activation blocking, including the `loading` state. A `disabled` prop or a styling data attribute alone does not prove the required behavior.
- [ ] Verify that the state is exposed, activation is blocked, the reason can be reached, focus moves correctly, and the user can recover. Follow the testing process in `.claude/skills/a11y/SKILL.md`.

## Scrollable regions

- [ ] **Every scrollable container needs `tabindex="0"`, `role="region"`, and an accessible name.** Safari has no native keyboard-focusable scrollers. Chrome 132+ handles scrollers without focusable children, but not those with focusable children.
- [ ] **Write CSS that enforces the attributes.** `[role="region"][aria-labelledby][tabindex] { overflow: auto; }` applies scrolling only when all the accessibility attributes are present.
- [ ] **Add a visible focus indicator to scroll containers.** WCAG 2.4.7 applies. Use a `:focus` outline with 3:1 contrast.
- [ ] **Consider a dynamic `tabindex`.** If a container scrolls only at certain viewport sizes, add or remove `tabindex="0"` when overflow is detected. A `tabindex="0"` on a container that does not scroll creates a confusing empty tab stop.
- [ ] **Avoid nested scrollable regions.** A table inside a dialog inside a page compounds keyboard complexity. Each nested scroller needs its own tabindex, role, and name.
- [ ] **Use horizontal scrolling only as a last resort, never as a content strategy.** Nothing native signals that content exists off screen. Safari/VoiceOver swipe gestures do not reliably scroll overflow regions. If you cannot avoid it, add `role="region"`, `aria-label`, `tabindex="0"`, visible previous and next controls, and a fallback that does not scroll (wrap or stack on mobile).

## Images and figures

- [ ] **Every `<img>` has an `alt` attribute.** Informative images need descriptive alt text. Decorative images use an empty `alt=""`, not a missing attribute. Without `alt`, screen readers announce the filename, which is gibberish.
- [ ] **Do not mark informative images as decorative.** A logo with `alt=""` tells screen readers "ignore this image". If the logo conveys information (brand identity, organization name), it needs descriptive alt. Use `alt=""` only for images that add nothing beyond what the surrounding text already says.
- [ ] **Images inside links and buttons must have non-empty alt text.** Empty alt here leaves the control with no accessible name, which fails WCAG 4.1.2.
- [ ] **Alt text describes function, not appearance.** For linked images, say where the link goes ("Go to homepage"), not what the image looks like ("Blue rectangular logo"). For content images, say what the image conveys, its purpose and significance, rather than listing what it shows.
- [ ] **Front-load the most important information in alt text.** Screen reader users may stop listening partway through. Put the key detail first.
- [ ] **Do not start alt text with "Image of", "Picture of", or "Photo of".** Screen readers already announce "image" or "graphic", so the prefix is redundant.
- [ ] **Alt text must not contain URLs, HTML, emoji, or line breaks.** Screen readers read URLs character by character. Line breaks make NVDA split the alt into separate "graphic" announcements. Emoji behave unpredictably across screen readers.
- [ ] **Never use the `title` attribute on `<img>` elements.** Touch and voice users cannot reach it. Screen readers read the title after the alt with no clear separator, which makes the output verbose.
- [ ] **Complex images need equivalent information on the page.** Give structured prose or a data table, whichever conveys the information better. Follow P13 in `/a11y` §5 for chart alternatives, and P27 if the description collapses. An informative image keeps a short alt that can point to the description. A long description nearby does not make the image decorative.
- [ ] **Never use `alt=""` with `aria-describedby`.** The screen reader skips the entire image, including the description. The alt must be non-empty for users to find the image.
- [ ] **Never rely on `aria-describedby` alone for complex image descriptions.** Support varies across browsers and screen readers. Always provide visible text on the page as the primary description.
- [ ] **`<figcaption>` does not replace `alt` text.** No screen reader uses `<figcaption>` as the accessible name for an image. Only NVDA announces figure boundaries at all. Images inside `<figure>` still need proper `alt`.
- [ ] **Never wrap `<figure>` in `<a>`.** `<figure>` does not take part in name-from-content, so the link gets no accessible name. TalkBack falls back to the raw URL, and VoiceOver on iOS repeats link announcements. Put the link inside the figure instead.
- [ ] **Never use CSS `content` for meaningful text.** JAWS with Chrome often ignores it entirely. Move the words into the DOM, using visually hidden spans if needed. CSS `content` is safe only for decorative characters.

## Skip links

- [ ] **Provide a working way to bypass repeated blocks.** A skip link that appears on focus is usually the simplest option, but headings, landmarks, or another mechanism may also serve the flow.
- [ ] **Review reading and focus order under `/a11y` §5.** Test the rendered sequence when CSS changes the visual placement.
- [ ] **"Skip to content" at page start** → targets `#main-content`.
- [ ] **"Skip to page navigation" at content end** (multi-page only) → targets `#praxity-page-nav`. It saves users from tabbing backward through all the content to reach Next/Previous.
- [ ] **Editor: "Skip to canvas"** → targets `#main-content` and bypasses the sidebar.

## Focus and keyboard

- [ ] **Focus order matches visual layout.** Tab should move through elements in the order they appear on screen. Test by tabbing through the entire page.
- [ ] **All interactive elements are reachable by keyboard.** Buttons, links, inputs, and custom widgets must all be focusable and operable without a mouse.
- [ ] **Visible focus indicator on all interactive elements.** Use one themed outline per target: 2px for controls and 3px for large focus targets. Suppress an inner input outline only when its enclosing choice/chooser row provides the visible ring. Inset rings inside clipping containers. Retain real outlines in forced colors and distinguish focus from selection.
- [ ] **`:focus-visible` vs `:focus`.** Define the ring on `:focus-visible` so it does not appear on every mouse click, and never write `:focus { outline: none }` without an equivalent visible style. `:focus-visible` is a browser heuristic, though, and it does not fire on pointer activation, so voice-control users and sighted screen reader users who click get no ring. Where losing the ring would leave those users without a visible focus point, style `:focus` unconditionally. `contrast-master` has the same rule; keep the two in sync.
- [ ] **No keyboard traps.** Users must be able to Tab into and out of every widget. Test modals, tree views, tab panels, and video players in particular.
- [ ] **Arrow keys within composite widgets.** Carousels, tab lists, trees, and toolbars use arrow keys inside the widget; Tab moves between widgets.
- [ ] **Radio indicators survive native arrow navigation.** Test Tab then ArrowDown in choice, group chooser, rating and matrix in Chromium, WebKit and Firefox. Inspect the painted row/control outline rather than relying on `:focus-visible`; WebKit can clear that heuristic after arrow navigation. Use scoped `:focus` where needed and keep pointer operation and selection usable.
- [ ] **Keyboard shortcuts avoid screen reader conflicts.** Never bind `Ctrl+Alt+N`, which launches NVDA. Users must be able to turn off or remap single-key shortcuts (WCAG 2.1.4). Prefer modifier combinations such as Ctrl+Shift, which avoid screen reader commands.

## Deletion focus management

- [ ] **After deleting an item from a group, focus the previous item's equivalent control.** Do not focus the next item or `<body>`. Landing on the previous item shows the user where they are and confirms the deletion worked.
- [ ] **If the first item was deleted, focus the container** (with `tabindex="-1"`) or a heading.
- [ ] **Delete buttons have compound accessible names.** Use "Delete [item name]", not just "Delete". Voice control users need unambiguous targets.
- [ ] **Announce the deletion through a live region, not a focused inline message.** Use an `aria-live="polite"` toast such as "[item name] deleted", with an undo hint if undo is available.
- [ ] **Consider protection against a double press.** If focus lands on another delete button after a deletion, an accidental Enter can delete that item too. Add confirmation or undo.

## Modal focus placement

- [ ] **Short informational dialogs:** focus the close button. Use `aria-describedby` for the message text.
- [ ] **Long or complex content dialogs:** focus the `<dialog>` element or its heading (`tabindex="-1"`). Do not use `aria-describedby` for complex content, because it flattens the structure.
- [ ] **Destructive action dialogs:** focus the least destructive option (Cancel, not Delete).
- [ ] **Legal and financial dialogs:** never focus the "I agree" button. Focus the heading or the dialog.
- [ ] **Short forms the user opened:** focusing the first field is acceptable if the user knows the flow.
- [ ] **Long or unfamiliar forms:** focus the dialog or heading, not a field, because a focused field opens the mobile soft keyboard.
- [ ] **Marketing or unexpected modals:** never focus a form field. Focus the close button or heading.

## Navigation placement

- [ ] **Prefer page navigation below the content in both DOM and visual order.** This usually gives the clearest forward flow. Placement alone is not a WCAG failure; test whether the actual order forces costly backward navigation.
- [ ] **Test the route from content to page navigation under `/a11y` §5.**
- [ ] **Navigation inside interactive blocks:** the tabs pattern puts controls before content, which is correct. Accordions place controls between sections of content, which is correct. Carousels put controls after content, which is acceptable if arrow keys work and a live region announces the state.

## Carousel and slides

These rules cover slides that change inside one document, such as a carousel block or Guided. They do not cover the Pages presentation, where Next and Previous load a new HTML document even when it looks like a slide. A Pages arrival focuses the content heading and writes no live message; its position sits in the page counter and outline. See "Pages arrival orientation" in `docs/context/published-output-runtime.md`.

- [ ] **`role="region" aria-roledescription="carousel"`** on the container.
- [ ] **Slide picker dots in `role="group" aria-label="Choose slide to display"`.** This follows the WAI-ARIA APG.
- [ ] **Each dot has `aria-label="Go to slide N"`, and the active dot has `aria-current="step"`.**
- [ ] **Arrow key navigation** within the carousel region, on the widget's own axis only: Left/Right for a horizontal carousel, Up/Down for a vertical one. Never bind both. Screen reader users press Down to read forward, so capturing it off-axis takes over their reading order.
- [ ] **State the item count when the user arrives at the section**, not only on navigation. Users need to know how much the section contains.
- [ ] **Announce position and content together, in one announcement, position first.** "Slide 2 of 5. <content>". If the position text sits in the DOM after the Previous/Next controls with no live region of its own, a screen reader user hears the content and all the controls before learning where they are.
- [ ] **One channel per state change.** Announce a slide change through a single polite live region. Never use both a live message and a changed control label for the same event, or it is read twice.
- [ ] **Prev/Next targets ≥44px with the action as the accessible name**, never a glyph.
- [ ] **No auto-rotation.** If auto-rotation is ever added, its control must come first in the tab order and rotation must respect `prefers-reduced-motion`.
- [ ] **Label the control group by its visible heading (`aria-labelledby`), not a repeated `aria-label` string.** VoiceOver re-announces a `role="group"` label on every control inside it, not once on entry, so a generic label repeats on each button.

## Tabs

- [ ] **Real tabs markup:** `role="tablist"` on the container, `role="tab"` on real `<button>`s, `aria-selected`, and `aria-controls` linking each tab to its panel.
- [ ] **Every tab gets its own panel.** Each panel carries its own `role="tabpanel"` and a matching `aria-labelledby` back to its tab. Never point every tab at one shared panel wrapper.
- [ ] **Roving tabindex: the tablist is one Tab stop.** Only the selected tab has `tabindex="0"`. The rest have `-1`, and users reach them with Left/Right plus Home/End. "Reachable by keyboard" and "reachable by Tab" are different things. Arrow keys already satisfy 2.1.1, so a tablist with five Tab stops can pass a naive keyboard test while using the wrong interaction model.
- [ ] **Manual activation.** Arrow keys move focus only; Enter, Space or click activates. Use automatic activation only when switching panels is instant and cheap.
- [ ] **Never bind Up/Down on a horizontal tablist** (or Left/Right on a vertical one, `aria-orientation="vertical"`). The off-axis arrows must pass through.
- [ ] **`tabindex` on the panel is conditional.** Add `tabindex="0"` only when the panel has no focusable content, or its first meaningful content is not focusable. Omit it when focus can land on a real control immediately; otherwise it adds a dead stop at the panel boundary. Adding it to every panel is wrong, and so is banning it.
- [ ] **Do not wrap a tablist in `<nav>`.** A tablist is not a set of links.
- [ ] **Do not put "selected" in a tab's `aria-label`.** `aria-selected` already announces it, and saying it twice is a bug.

## Interactive video

- [ ] **Announce required interactions on mount.** When `requireCompletion` is true, a live region says "This video contains required interactions" before playback.
- [ ] **`inert` on the video wrapper while the required interaction panel is open.** It stops keyboard and screen reader users from moving back to the video controls while the quiz is active.
- [ ] **A live region announces cue activations.** It says "Video paused: {label}" when an interaction appears.
- [ ] **All player controls are keyboard accessible.** Play, pause, seek, mute, and fullscreen must all work with Tab, Enter, and Space.

## Tables

- [ ] **Use native `<table>` for data tables.** Never use a `<div>` styled as a grid for tabular data. Screen readers offer cell navigation (`Ctrl+Alt+Arrow`) and header association only for real tables.
- [ ] **Name a data table when surrounding context does not identify it.** `<caption>` is usually best; `aria-labelledby` can reuse a visible heading. A missing name is not automatically a failure when context already makes the table clear.
- [ ] **Column and row headers use `<th>` with `scope`.** Use `<th scope="col">` for column headers and `<th scope="row">` for row headers. Without `scope`, screen readers guess, and for complex tables they guess wrong.
- [ ] **Responsive tables use a scrollable wrapper, not CSS display overrides.** Wrap the `<table>` in `<div role="region" aria-labelledby="caption-id" tabindex="0">` with `overflow-x: auto`. This keeps table semantics and allows horizontal scrolling. The `tabindex="0"` makes the scroll container reachable by keyboard.
- [ ] **Never apply `display: flex/grid/block/contents` to table elements.** Safari strips table semantics when CSS display properties override table elements. If you cannot avoid it, add ARIA repair roles (`role="table"`, `role="row"`, `role="columnheader"`, `role="cell"`, etc.) to every element.
- [ ] **Do not use `role="grid"` on data tables.** `role="grid"` signals a spreadsheet-like widget whose cells can each take focus or be edited. For sortable columns, put a `<button>` inside the `<th>` with `aria-sort`. That is a table pattern, not a grid pattern.
- [ ] **Sortable columns: `aria-sort` on `<th>`, `<button>` inside.** Use `aria-sort="ascending"`, `"descending"`, or `"none"`. Announce sort changes through a `role="status"` live region ("Sorted by Name, ascending").
- [ ] **Lists with `list-style: none` need `role="list"`.** Safari strips list semantics when `list-style: none` is applied. Add `role="list"` to the `<ul>` or `<ol>` to restore them.

## Media and embeds

Video and audio players and iframes contain many focusable controls, often 8+ tab stops: play, pause, volume, seek, captions, fullscreen, share. Without a way past them, keyboard and screen reader users must tab through every control before reaching the next piece of content. [Jacob Wood's good example](https://www.jacobwood.me/demos/good_example.html#widgets) shows the right pattern, and [the bad example](https://www.jacobwood.me/demos/bad_example.html#widgets) shows the hostile version.

- [ ] **Provide a practical way past long player or iframe control sequences.** The next real section heading is often the simplest option. A bypass link, a useful landmark, or a short native control sequence can also work. Test the actual embed before reporting a barrier.
- [ ] **Every `<iframe>` has a descriptive `title`.** Write `<iframe title="YouTube video player: Installing NVDA">`, not a bare `<iframe>`. Screen readers announce the title when entering the iframe.
- [ ] **No autoplay.** Audio must not play automatically, or must stop within 3 seconds, or must have a way to pause or stop it. Autoplaying video must have accessible pause/stop controls placed before the video.
- [ ] **Native `<video>` must have the `controls` attribute.** Without `controls`, keyboard users cannot operate the player. Use `preload="none"` for direct video the user starts; autoplay may use `preload="auto"`. Use `preload="metadata"` only when the duration is genuinely needed before interaction. Include a `poster` image when available.
- [ ] **Caption files must be same-origin in SCORM packages.** Browsers block cross-origin `<track>` resources. SCORM export must bundle `.vtt` files alongside the video or use inline captions. Never rely on YouTube auto-captions for WCAG compliance; they contain errors and no author has verified them.
- [ ] **Author-provided captions and transcripts are required.** Auto-generated captions (YouTube, etc.) do not meet WCAG 1.2.2 (Captions). Authors must provide or verify caption files. Audio-only content requires a transcript (WCAG 1.2.1).
- [ ] **Embed blocks: provide a fallback link.** If JavaScript fails or the iframe does not load, users must still be able to reach the content. Include a visible `<a>` to the original URL as fallback content.
- [ ] **Embed blocks: use the facade/srcdoc pattern for heavy embeds.** YouTube, Vimeo, and similar embeds load 500KB+ of tracking scripts. Show a static preview image with a play button, and load the real iframe only when the user interacts. The `srcdoc` attribute can hold the facade HTML.
- [ ] **Embed blocks: use privacy-respecting URLs.** Use `youtube-nocookie.com` instead of `youtube.com` for YouTube embeds. Use `loading="lazy"` to defer offscreen embeds.
- [ ] **Embed blocks: constrain dimensions.** Use the `aspect-ratio` CSS property and `max-height` so embeds do not overwhelm the viewport on small screens. Never use fixed pixel heights without responsive fallbacks.
- [ ] **Embed play buttons must be keyboard-operable and have enough contrast.** Use a standard `<a>` or `<button>` in `srcdoc`. The play button SVG must use concentric black and white strokes so it keeps its contrast against any poster image (WCAG 1.4.11). Make the target at least 44x44px.
- [ ] **Set an explicit background in `srcdoc` embeds.** Without one, forced-colors mode inherits the page background and the placeholder may be invisible.
- [ ] **Use `<source media="(prefers-reduced-motion: reduce)">` for motion-intensive videos.** Serve a reduced-motion variant. Order the most specific media queries first and the generic fallback last. Never use the `forced-colors` media query to select a video source.

## Toggle and switch controls

- [ ] **Use `<button aria-pressed>` as the default toggle pattern.** It has the most reliable screen reader support: every major screen reader announces "toggle button, pressed/not pressed". Use it for editor UI toggles that take effect immediately.
- [ ] **Use `<input type="checkbox">` styled as a toggle for controls that submit with a form.** It works without JS as progressive enhancement and needs no ARIA.
- [ ] **Reserve `role="switch"` for settings panels.** Accept that NVDA + Firefox and VoiceOver + iOS announce it as "checkbox" instead of "switch" (~15-20% of screen reader users). Use `aria-checked`, not `aria-pressed`, with `role="switch"`.
- [ ] **Never combine `aria-pressed` and `role="switch"`.** `role="switch"` uses `aria-checked`. `aria-pressed` belongs to toggle buttons without `role="switch"`.
- [ ] **Review toggle labels and states under `/a11y` §5.**
- [ ] **Review changing labels and announcement channels under `/a11y` §5.** Check that the visible label and the accessible name agree, and check actual speech under §2.
- [ ] **A state indicator that does not rely on color is required.** A change in thumb position is the minimum (WCAG 1.4.1). Component boundaries need 3:1 contrast (WCAG 1.4.11).
- [ ] **Use `em` units for toggle sizing.** They scale with the user's text-size preferences (WCAG 1.4.12).
- [ ] **Support `prefers-reduced-motion: reduce`.** Turn off slide animations.
- [ ] **Support `@media (forced-colors: active)`.** Use system color keywords for the toggle track and thumb.
- [ ] **Visually hide checkboxes with clip-rect, not `display: none`.** `display: none` removes them from the accessibility tree.
- [ ] **`role="switch"` implies immediate effect.** Using it on a control that needs form submission is a WCAG Level A violation (SC 4.1.2).

## Select and combobox controls

- [ ] **Use native `<select>` to pick one option from a closed list.** It had a 100% success rate in user testing, and the mobile dismiss gestures always work. Choose it first unless its styling truly cannot meet the need.
- [ ] **Apply `font: inherit; letter-spacing: inherit; word-spacing: inherit;` to `<select>`.** This stops iOS from zooming on focus and meets WCAG 1.4.12.
- [ ] **Use checkboxes in a `<fieldset>` for multi-select, never `<select multiple>`.** `<select multiple>` had a 25.3% success rate in user testing. Group the checkboxes in a `<fieldset>` with a `<legend>`, or, where space is tight, use a disclosure widget with a counter badge.
- [ ] **Use the ARIA 1.2 combobox pattern, not 1.1.** Put `role="combobox"` on the input, with `aria-controls` pointing to the listbox. Do not use the wrapping-container pattern.
- [ ] **Do not use `role="menu"` for selection controls.** Menus are only for OS-level application actions. Use `role="listbox"` for custom selects.
- [ ] **Do not mix native `<select>` and a custom ARIA listbox on the same page.** Inconsistent dismiss gestures make mobile users leave the page by accident.
- [ ] **Use native `<select>` in published learner-facing output.** SCORM/xAPI learners on mobile depend on the dismiss gestures working.
- [ ] **Do not use "drop-down" in design specs or code.** Use the precise term: "select", "combobox", "listbox", or "disclosure".

## Responsive typography

- [ ] **Choose font units that preserve user scaling.** Relative units are usually best, but `px` does not automatically fail WCAG. Test that text reaches 200% without loss of content or functionality.
- [ ] **Never use `vw`/`vh` as the only font-size unit.** It fails WCAG 1.4.4 (W3C failure technique F94). Viewport units shrink when users zoom, which cancels out the zoom.
- [ ] **Test `clamp()` at 200% zoom.** A max-to-min ratio is only a heuristic. The conformance question is whether rendered text scales without loss of content or functionality.
- [ ] **Do not reduce font sizes at narrower breakpoints.** Browser zoom shrinks the viewport and triggers the narrower breakpoints, so zooming in would make text smaller.
- [ ] **Set `html { font-size: 100% }` or leave it unset.** Never set a fixed `px` or `62.5%` value.
- [ ] **Form elements: `font: inherit`.** Without it, inputs, selects, and buttons reset to browser defaults and ignore the user's typography.
- [ ] **The viewport meta tag must not disable zoom.** Do not use `maximum-scale=1`, `user-scalable=no`, or `user-scalable=0`. Use `<meta name="viewport" content="width=device-width, initial-scale=1.0">`.
- [ ] **Use `hyphens: auto` for text reflow, not `word-break: break-all`.** `break-all` produces illegible text. `overflow-wrap: break-word` is also acceptable.
- [ ] **Test at 200% zoom and a 320px viewport width.** Check that text scales, content reflows, and vertical content needs no horizontal scrolling.
- [ ] **Do not offer a "dyslexia mode" with OpenDyslexic or Dyslexie.** In Readability Group testing these fonts did far worse than standard fonts (OpenDyslexic: 12% success rate). The benefits come entirely from spacing, not letter shapes.
- [ ] **Choose fonts with distinct I/l/1 and d/b/p/q letterforms.** Avoid Gill Sans and geometric sans serifs where these characters look alike. Prefer humanist sans serifs with open counters and apertures.
- [ ] **Do not use italic as the main text style.** Italics make reading much harder for dyslexic readers. Use italic for inline emphasis only, never as the default body style.
- [ ] **Do not use `!important` on font or spacing CSS in published output.** It blocks user overrides through browser settings and user stylesheets, which risks failing WCAG 1.4.12.

## Contrast and color

- [ ] **4.5:1 minimum for normal text** below 18pt normal or 14pt bold, where WCAG 1.4.3 applies. For inactive controls, follow [Disabled controls](#disabled-controls).
- [ ] **3:1 minimum for large text** at least 18pt normal or 14pt bold, where WCAG 1.4.3 applies. Apply WCAG 1.4.11 to required component and graphic information. For inactive controls, follow [Disabled controls](#disabled-controls).
- [ ] **Never use `c="dimmed"` in published output.** Mantine's dimmed color is borderline. Use `c="var(--praxity-color-text-light, #4a5a00)"` instead.
- [ ] **Placeholder text meets the text contrast threshold that applies.** Override Mantine's default through `.praxity-page-content ::placeholder` where needed. For inactive controls, follow [Disabled controls](#disabled-controls).
- [ ] **Do not convey information by color alone.** Always pair color with text, icons, or patterns.
- [ ] **Test in Windows High Contrast Mode (forced-colors).** Custom controls must stay visible. Focus indicators must use `outline`, because forced-colors mode strips `box-shadow`. SVG icons must use `currentColor`. State changes must not rely only on `background-color`.
- [ ] **Add `border: 2px solid transparent` to custom interactive controls.** The border is invisible normally and becomes visible in forced-colors mode, when the browser replaces `border-color` with a system color.
- [ ] **Never use `forced-color-adjust: none` where color is not the content.** It suits only color swatches and data visualization where color carries the meaning. Flag any other use.
- [ ] **Do not claim "WCAG 3 compliant" or "APCA compliant".** APCA is not in any W3C spec. WCAG 2.x contrast ratios remain the legally binding standard. Use BridgePCA if you want APCA's benefits while keeping WCAG 2.x compliance.

## CSS-only widgets

- [ ] **Review CSS-only widgets under `/a11y` §5.** Verify their actual semantics and keyboard behavior.
- [ ] **Apply the Praxity reading-order default (P11 in `/a11y` §5).** Keep the visual, reading, and focus order in step wherever the order carries meaning. Test responsive reordering. Report a missing default separately from a demonstrated failure of WCAG 1.3.2 or 2.4.3.

## Skeleton loading states

- [ ] **Skeleton placeholder shapes: `aria-hidden="true"`.** They are visual only and mean nothing to screen readers.
- [ ] **Include "Loading" text that screen readers can reach.** Put a visually hidden `<span>Loading</span>` inside the skeleton container.
- [ ] **Skeleton shapes need 3:1 only when they convey required information.** Purely decorative placeholders are exempt from non-text contrast; expose the loading state in text.
- [ ] **Review skeleton motion under `/a11y` §5.** Record the applicable requirements separately from the preferred reduced-motion support.
- [ ] **Do not rely on `aria-busy` alone.** Most screen readers ignore it (only JAWS 2020 honored it). Pair it with `display: none` or `aria-hidden`.

## Testing

Commands, engine setup, and environment triage live in `/a11y` §0 and §2. Keep command names out of this file; copying them here is how this section went stale before.

- [ ] **Rule out the environment before recording a manual finding as a defect.** See `/a11y` §2.1 for Safari keyboard settings, scanner and iframe mismatches, and the first-load rotor glitch.
- [ ] **Test keyboard, focus, and visual-state fixes in WebKit, Chromium, and Firefox.** Some real defects reproduce in one engine and stay invisible in the others, so passing in one engine does not count as passing.
- [ ] **Run live screen-reader verification in the target host.** Use the actual T3 preview host with VoiceOver for the thin canvas, plus Safari with VoiceOver for published output. The Studio Electron app is retired. Results from one are not evidence for the other.
- [ ] **Verify a new interactive component standalone before placing it on a full page.**
- [ ] **VoiceOver rotor test.** Open the rotor (VO+U) and check that Landmarks, Headings, and Lists match the expected structure. If the very first load looks wrong, reload once before trusting the result.
- [ ] **Tab-through test.** Tab from the start of the page to the end and back. Check for a logical order, no traps, and visible focus on every stop. Do this in all three engines.
- [ ] **Run the project a11y suite and the rule-coverage test.** `/a11y` §0 lists this project's commands.
