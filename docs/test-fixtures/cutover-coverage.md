---
{ variables: { attempts: 0 } }
---

# Cutover coverage

## Sections

::: accordion
:: First section
Read the first section.

:: Second section
Read the second section.
:::

## Formats

::: tabs {orientation=vertical style=pills}
:: Text
Read this text.

:: More text
Read the other text.
:::

::: table {gridlines=rows striped columnAlignments="left, right"}
| Control | Purpose |
| --- | --- |
| Valve | Stop flow |
| Gauge | Read pressure |
:::

::: group Knowledge check {mode=all passingScore=50 requireAll showResultsSummary level=2}
::: choice Which action helps? {scored points=2 level=3 attempts=2 required shuffle}
(x) Listen
( ) Interrupt
:::
:::

::: match Match controls {shuffle=false scored level=2}
- Valve -> Stop flow
- Gauge -> Read pressure
:::

::: order Order actions {scored level=2}
1. Stop
2. Check
:::

::: categorize Categorize controls {shuffle level=2}
:: Flow
- Valve
:: Pressure
- Gauge
:::

::: fill-blank Complete the instruction {scored style=typed level=2}
Check the {gauge}.
:::

::: free-response Reflect on the procedure {scored level=2}
placeholder: Write your reflection
:::

::: matrix Confidence {scored=false attempts=0 level=2}
1. Low
2. High
- Using the valve
- Reading the gauge
:::

::: hotspot Identify the control
![Diagram of a valve and gauge](/assets/test-hotspot.webp)
- Valve {x=30 y=40 correct}
- Gauge {x=60 y=50}
:::

::: rating Rate this lesson {required name=lesson-rating style=slider level=2}
1. Low
2. High
:::

::: cards Cards {level=3 style=outline media=flush transition=fade showProgress}
:: Front
![Example illustration](/assets/test-image.webp){ratio=16:9 fit=contain}

Review the illustration.

::: back
Read the explanation.
:::
:::

::: comparison {layout=side-by-side}
:: Before {level=2}
Review the request.

:: After {level=2}
Confirm the request.
:::

::: sequence
:: Prepare {level=2}
Read the request.

:: Review {level=2}
Check the details.
:::

::: quote
Respect builds trust.
speaker: Stephen Covey
:::

## Media and controls

![](/assets/test-image.webp){decorative alignment=right}

::: video /assets/test-video.mp4
title: Procedure demonstration
:::

::: audio /assets/test-audio.mp3
title: Procedure briefing
:::

::: embed https://example.com/procedure {height=400}
:::

::: button [Read the procedure](https://example.com/procedure) {style=outline newTab}
:::

::: note {tone=warning style=shaded}
Review the procedure before continuing.
:::

::: checklist {required}
- [ ] Read the procedure
- [ ] Check the controls
:::

::: signature Confirm your review {mode=type level=2}
:::

---

::: rule
if: attempts is 0
then: show @lesson-rating
:::
