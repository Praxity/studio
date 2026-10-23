---
title: Comprehensive Grammar v3 Test Course
theme: campfire
lang: en
design:
  palette: campfire
  colorMode: light
  accentHue: 210
  typography:
    fontDisplay: swap
    body: { fontFamily: [ Inter, sans-serif ], fontWeight: 400, fontStyle: normal }
    headings: { fontFamily: [ Inter, sans-serif ], fontWeight: 600, fontStyle: normal }
  headingSize: 1.5
  lineHeight: 1.6
  density: comfortable
  sectionGap: 48
  contentMaxWidth: 720
  borderRadius: 8
  shadowIntensity: subtle
  dividerStyle: gradient
  backgroundTexture: grain
  highlightStyle: marker
  navArchetype: sidebar
  navPrevNext: true
  navProgressStyle: bar
  motionEntrance: fade
  componentDefaults: {}
variables:
  userName: Learner
  quizScore: 0
  completedModules: 0
  source: direct
---

# Rich Content & Typography

This course exercises every grammar v3 block type, variant, modifier, and option available in the Praxity Studio grammar. It serves as a test fixture for the parser, serializer, and renderer.

Inline prose links are testable in this fixture through the [WCAG 2.2 standard](https://www.w3.org/TR/WCAG22/).

## Inline Formatting & Doodles

Text with **bold** and *italic* and **bold *nested italic*** formatting. Doodle annotations: @underline{basic underline} and @underline.animated{animated underline} and @underline.thick{thick underline} and @underline.thin{thin underline}. A @circle{circled term} and a @circle.box{boxed term} and @circle.animated{animated circle}. We can @highlight{highlight text} or use @highlight.marker{marker highlight} or @highlight.green{green highlight} or @highlight.thick.red{thick red highlight}. There is @strike{strikethrough} and @strike.crossed{crossed strike}. Finally @bracket{bracketed text} and @bracket.sketch{sketch bracket}.

More combos: @underline.marker.black{marker black underline}, @underline.thin.red{thin red underline}, @highlight.thick.green{thick green highlight}, @underline.sketch{sketch underline}.

Tooltips: workers must @highlight{wear [PPE]{Personal Protective Equipment — gear that protects the wearer from injury.} on site}, per [WCAG]{Web Content Accessibility Guidelines} training policy.

## Bullet Lists

- Perceivable: users must be able to perceive the information being presented
- Operable: all functionality must be available from a keyboard
- Understandable: content must be readable and predictable
- Robust: content must be compatible with assistive technologies

## Images

Local image asset (auto-detected by extension):

![A diverse group of people collaborating around a table with various assistive technologies](/assets/test-image.webp)

Local image with caption line:

![A laptop displaying accessibility audit results](/assets/test-image-wide.webp)

Decorative image (no alt needed):

![](/assets/test-image.webp){decorative}

---

## Note Variants

Accent note (blockquote with as: note):

::: note {tone=note style=shaded}
An **accent** note (default color) with inline formatting.
:::

::: note {tone=info style=shaded}
A **primary** note with a custom title.
:::

::: note {tone=success}
A **success** note confirming something went well.
:::

::: note {tone=warning style=outline}
A **warning** note about potential issues.
:::

::: note {tone=warning}
An **error** note signaling a critical problem.
:::

::: note {tone=tip style=outline}
A **grey** note for secondary or background information.
:::

---

## Quote Variants

Default quote (blockquote, no as: needed):

::: quote
The power of the Web is in its universality. Access by everyone regardless of disability is an essential aspect.
speaker: Tim Berners-Lee, W3C Director
:::

Quotation marks decorator:

::: quote
Do the best you can until you know better. Then when you know better, do better.
speaker: Maya Angelou
:::

Cinematic large quote:

::: quote
Imagination is more important than knowledge.
speaker: Albert Einstein
:::

Very large quote:

::: quote
Innovation distinguishes between a leader and a follower.
speaker: Steve Jobs
:::

---

## Code Blocks

HTML code:

```html
<nav aria-label="Main navigation">
  <ul>
    <li><a href="/home">Home</a></li>
    <li><a href="/about" aria-current="page">About</a></li>
  </ul>
</nav>
```

JavaScript code:

```javascript
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal();
    previousFocusElement.focus();
  }
});
```

CSS code:

```css
:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}
@sources
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Python code:

```python
def calculate_contrast_ratio(l1: float, l2: float) -> float:
    """Calculate WCAG contrast ratio between two luminances."""
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)
```

## Equation

$$
\frac{L_1 + 0.05}{L_2 + 0.05} \geq 4.5
$$

## Button Variants

::: button [Filled Button (Default)](https://www.w3.org/WAI/WCAG21/quickref/) {style=filled}
:::

::: button [Outline Button](https://www.w3.org/WAI/) {style=outline}
:::

::: button [Light Button](https://webaim.org/) {style=light}
:::

::: button [Opens in Same Tab](https://developer.mozilla.org/en-US/docs/Web/Accessibility) {newTab=false}
:::

## Bookmark Embeds

::: bookmark [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
:::

## Embed (iframe)

Embed an external page via iframe:

::: embed https://www.figma.com/embed?embed_host=share&url=https://www.figma.com/file/1
title: Figma design example
:::

## Pipe-Delimited Table

::: table
| Feature | WCAG Level | Criteria |
|---------|-----------|----------|
| Color Contrast | AA | 4.5:1 for normal text |
| Large Text Contrast | AA | 3:1 for 18pt+ or 14pt bold |
| Non-text Contrast | AA | 3:1 for UI and graphics |
| Enhanced Contrast | AAA | 7:1 for normal text |
title: WCAG contrast requirements by level
:::

## Table with Chart

::: table {chart=bar}
| Quarter | Revenue | Users |
|---------|---------|-------|
| Q1 | 120 | 450 |
| Q2 | 180 | 620 |
| Q3 | 240 | 810 |
| Q4 | 310 | 950 |
title: Revenue and users by quarter
xLabel: Quarter
yLabel: Amount
:::

# Media & Embeds

## Video

YouTube video (URL auto-detected as video):

::: video https://www.youtube.com/watch?v=aqz-KE-bpKQ {start=5 end=45}
caption: Big Buck Bunny sample video
title: Big Buck Bunny
transcript: This animated sample follows Big Buck Bunny through a forest encounter.
:::

Direct video (native video element):

::: video https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4
title: Flower in bloom
caption: A silent close-up video of a flower moving in the breeze
transcript: Silent video showing a white flower moving gently in the breeze.
:::

## Audio

::: audio /../superpowers/specs/evidence/2026-08-10-soniox-narration/en-control.mp3
title: Spoken Narration Sample
transcript: Technical terms: WCAG, SCORM, xAPI, and Praxity. Course ABC-123 costs $1,249.50 on August 10, 2026.
:::

# Container Blocks

## Columns

Two equal columns using as:col / close:col containers:

::: columns
::
### Perceivable

Users must be able to perceive the information being presented. Provide text alternatives, captions, and adaptable content.

::
### Operable

All functionality must be available from a keyboard. Users need enough time, and navigation must be predictable.
:::

## Three Columns

Three-column layout:

::: columns
::
### Visual

Color contrast, text size, and spacing affect readability for users with low vision.

::
### Auditory

Captions and transcripts ensure deaf and hard-of-hearing users access audio content.

::
### Motor

Large touch targets, keyboard access, and voice control support users with motor disabilities.
:::

## Accordion

::: accordion
:: Accessibility Standards
WCAG 2.2: The Web Content Accessibility Guidelines provide a single shared standard for web content accessibility. Published by W3C.

:: Section 508
US federal law requiring electronic and information technology to be accessible to people with disabilities.

:: EN 301 549
European standard for ICT accessibility, aligned with WCAG but covering broader categories.
:::

## Tabs

::: tabs
:: Automated
Run automated checks with tools like axe-core, WAVE, or Lighthouse in CI and fix the issues they report. Then complete a full manual review of the applicable WCAG success criteria, including keyboard and screen reader testing. A clean automated scan does not establish conformance.

:: Manual
Keyboard testing, visual inspection, and cognitive walkthrough catch issues tools cannot.

:: Assistive Tech
Test with actual screen readers, magnifiers, and voice control software used by real users.

:: User Testing
Nothing replaces having people with disabilities test your product. Recruit diverse testers.
:::

## Sequence (Numbered)

::: sequence {style=numbered}
:: Plan
Define scope, select standards (WCAG level), identify pages and flows to audit. Assemble your testing toolkit.

:: Test
Run automated scans, perform manual keyboard testing, test with screen readers, check responsive behavior.

:: Report
Document findings with severity ratings. Include screenshots, code snippets, and remediation guidance.

:: Remediate
Fix issues by priority. Quick wins first, then structural changes. Re-test after each batch of fixes.

:: Monitor
Set up CI checks, schedule periodic audits. Accessibility is ongoing, not a one-time activity.
:::

## Sequence (Timeline)

::: sequence {style=timeline orientation=vertical}
:: 1999
WCAG 1.0 published by the W3C. First formal guidelines for web content accessibility.

:: 2008
WCAG 2.0 released. Introduced the POUR principles and technology-agnostic success criteria.

:: 2018
WCAG 2.1 added mobile accessibility, low vision, and cognitive disability criteria.

:: 2023
WCAG 2.2 published with new criteria for focus appearance, dragging movements, and consistent help.
:::

## Comparison (Side by Side)

::: comparison {layout=side-by-side}
:: Before
The old design used low-contrast gray text on a white background. Buttons were tiny and unlabeled.

:: After
The redesign uses high-contrast text, large labeled buttons, and clear focus indicators throughout.
:::

## Card Container

::: cards Key Takeaway
:: Key Takeaway {level=3}
Remember: accessibility is not a feature you add at the end. It is a quality of thoughtful design from the start. Build with inclusion in mind.
:::

## Card (Flip)

::: cards {style=outline layout=slides}
:: What does POUR stand for?
P O U R

::: back
Perceivable, Operable, Understandable, Robust — the four principles of WCAG.
:::

:: What is the minimum contrast ratio for normal text under WCAG AA?
Minimum AA ratio for normal text?

::: back
4.5:1 — for text that is smaller than 18pt (or 14pt bold).
:::
:::

# Assessment Blocks

## Single Choice

::: choice What is the minimum contrast ratio for normal text under WCAG AA? {scored points=10 shuffle}
Normal text means anything below 18pt, or below 14pt bold.
( ) 2:1
feedback: This ratio is too low. WCAG AA requires at least 4.5:1 for normal text.
( ) 3:1
feedback: Close, but 3:1 is the minimum for large text. Normal text requires 4.5:1.
(x) 4.5:1
feedback: Correct! WCAG AA requires 4.5:1 for normal text and 3:1 for large text.
( ) 7:1
feedback: This is the AAA requirement, not AA.
:::

## Multiple Choice

::: choice Which of the following are WCAG 2.2 principles? Select ALL that apply. {scored points=10}
[x] Perceivable
[ ] Predictable
[x] Operable
[ ] Performant
[x] Understandable
[x] Robust
:::

## Matching

::: match Match each accessibility feature to the WCAG principle it primarily supports {scored points=10 shuffle}
- Alt text on images -> Perceivable
- Keyboard navigation -> Operable
- Clear error messages -> Understandable
- Valid semantic HTML -> Robust
:::

## Ordering

::: order Put these heading levels in the correct hierarchical order {scored points=10}
1. h1 — Page title
2. h2 — Major sections
3. h3 — Subsections
4. h4 — Sub-subsections
:::

## Free Response

::: free-response In your own words, explain why accessibility is important for eLearning specifically
Consider the diverse needs of adult learners in corporate, academic, and self-paced contexts.
placeholder: Write a short paragraph
:::

## Fill in the Blank

::: fill-blank Complete the ARIA attribute for a modal dialog
The modal container should have role="____" and aria-modal="____" to properly communicate its purpose to screen readers.
:::

## Rating Scale

::: rating How confident are you in your ability to audit a website for WCAG compliance?
1. Not at all confident
2. Slightly confident
3. Somewhat confident
4. Quite confident
5. Very confident
:::

# Complex Assessments

## Categorize

::: categorize Sort these techniques into the correct WCAG principle {scored points=12 shuffle}
:: Perceivable
- Providing alt text for images
- Adding captions to videos
- Ensuring sufficient color contrast
:: Operable
- Making all functionality keyboard accessible
- Providing skip navigation links
- Allowing users to pause auto-playing content
:: Understandable
- Using clear and simple language
- Labeling form inputs correctly
- Providing error suggestions
:: Robust
- Using valid semantic HTML
- Testing with multiple assistive technologies
- Ensuring ARIA attributes are correct
:::

## Hotspot Assessment

::: hotspot Click the accessibility issues on the image:
![Annotated screenshot of a web page with accessibility issues](/assets/test-hotspot.webp)
- Missing alt text {x=25 y=30 correct}
- Low contrast button {x=60 y=50 correct}
- Decorative border {x=80 y=10}
:::

# Assessment Groups

## Assessment Group

::: group WCAG Fundamentals Assessment {mode=all passingScore=35}
::: choice What does ARIA stand for? {scored points=5 level=3}
(x) Accessible Rich Internet Applications
( ) Automated Reader Interface Attributes
( ) Accessible Responsive Interactive Attributes
:::
::: choice Which HTML element provides a navigation landmark? {scored points=5 level=3}
( ) div
(x) nav
( ) section
( ) aside
:::
:::

## Assessment Group (Choose One)

::: group Pick Your Strength {mode=oneOf passingScore=50}
::: choice What is the purpose of the lang attribute on the html element? {scored points=5 level=3}
(x) It declares the primary language of the page for screen readers and search engines
( ) It sets the text direction for the page
( ) It enables spell-checking in form fields
:::
::: choice Which WCAG level is typically required by law? {scored points=5 level=3}
( ) Level A only
(x) Level AA
( ) Level AAA
:::
:::

# Interactive & Social Blocks

## Checklist

::: checklist {required}
- [ ] Verify all images have meaningful alt text
- [ ] Test keyboard navigation through the entire course
- [ ] Check color contrast ratios meet WCAG AA
- [ ] Verify form labels are properly associated
- [ ] Test with a screen reader (VoiceOver, NVDA, or JAWS)
- [ ] Ensure focus order is logical
- [ ] Check that error messages are descriptive and announced
:::

## Signature

::: signature I confirm that I have reviewed the accessibility guidelines {mode=draw}
:::

::: signature I agree to follow WCAG 2.2 AA in my work {mode=type}
:::

# Variables & Logic

Hello {{userName}}, this page's declarations are invisible machinery — only
interpolated values like your name and this paragraph render for learners.

## Variable Declarations

## Logic Rules

::: rule
if: quizScore >= 80
then: show @certificate-section
:::

::: rule
if: completedModules >= 3
and: quizScore >= 70
then: show @advanced-content
:::

::: rule
if: userName is "Admin"
then: jump @admin-panel
:::

# Layout Modifiers & Advanced Features
nav: Layout & Structure

## Section Divider

Content above the divider.

---

Content below the divider.

## Kickers

### What makes a good heading hierarchy?

Headings should follow a logical order without skipping levels. Screen readers use them to navigate.

## Advanced ARIA Patterns

When native HTML semantics are insufficient, ARIA attributes can bridge the gap — but always prefer native elements first.

## Escaped Line

The following line uses an escape to prevent it from being parsed as a heading:

\### This is not a heading — it is literal text

## Combining Features

A rich paragraph with multiple doodle types: The @underline.animated{four principles of WCAG} are @circle{Perceivable}, @circle{Operable}, @circle{Understandable}, and @circle{Robust}. These form the @highlight.marker{POUR framework} which is @bracket{the foundation of web accessibility}.

# Summary

This course exercised the following v3 grammar features:

::: accordion
:: Content Blocks
text, heading (h1-h4), image (local assets, decorative), video, audio, embed (iframe), note (6 colors x 2 styles), quote (3 decorators x 3 sizes), code (4 languages), equation, button (3 variants), bookmark, divider, table (pipe-delimited), chart

:: Containers
columns (2-col, 3-col via as:col/close:col), accordion (implicit grouping via as:accordion), tabs (implicit grouping via as:tab), sequence (numbered, timeline), comparison (side-by-side), card (as:card/close:card with layout: grid/masonry/single and card:back for flip)

:: Assessments
choice (single radio, multi checkbox), match, order, free-response, fill-blank, rating, categorize, hotspot (image with spots), assessment-group (with close)

:: Interactive
checklist (task list with as:checklist), signature (draw, type)

:: Variables & Logic
var declarations (short form, extended form, url-param source), when/and/then logic rules, show/hide/jump actions

:: Formatting
bold, italic, nested bold+italic, doodles (underline, circle, highlight, strike, bracket) with modifiers (animated, box, crossed, sketch, thin, thick, marker, green, red, black)

### Structure

page breaks (--- with titles), section dividers (--), layout modifiers, kickers (#### before headings), escaped lines, pipe-separated params, bullet lists

::: note {tone=success style=shaded}
All implemented grammar v3 block types, variants, modifiers, and options are represented in this test fixture.
:::
:::
