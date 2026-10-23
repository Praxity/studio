---
{ cast: { alex: {}, sam: {} } }
---

# Catalog heading {hideTitle}

## Section title

# Catalog heading serialized {hideTitle}

## Section title

# Catalog text {hideTitle}

Write your content here.

# Catalog text serialized {hideTitle}

Write your content here.

# Catalog note {hideTitle}

::: note {tone=note}
Important information for learners.
:::

# Catalog note serialized {hideTitle}

::: note {tone=note}
Important information for learners.
:::

# Catalog quote {hideTitle}

::: quote
A meaningful quote goes here.
speaker: Author Name
:::

# Catalog quote serialized {hideTitle}

::: quote
A meaningful quote goes here.
speaker: Author Name
:::

# Catalog dialogue {hideTitle}

::: dialogue
- Alex: What should I say when the meeting starts?
- Sam: Start with the goal, then ask what everyone needs.
:::

# Catalog dialogue serialized {hideTitle}

::: dialogue
- Alex: What should I say when the meeting starts?
- Sam: Start with the goal, then ask what everyone needs.
:::

# Catalog code {hideTitle}

```javascript
console.log("Hello, world!");
```

# Catalog code serialized {hideTitle}

```javascript
console.log("Hello, world!");
```

# Catalog equation {hideTitle}

$$
E = mc^2
$$

# Catalog equation serialized {hideTitle}

$$
E = mc^2
$$

# Catalog image {hideTitle}

![Describe the image for accessibility](/assets/test-image.webp)

# Catalog image serialized {hideTitle}

![Describe the image for accessibility](/assets/test-image.webp)

# Catalog video {hideTitle}

::: video /assets/test-video.mp4
caption: Video description
:::

# Catalog video serialized {hideTitle}

::: video /assets/test-video.mp4
caption: Video description
:::

# Catalog audio {hideTitle}

::: audio /assets/test-audio.mp3
title: Audio title
:::

# Catalog audio serialized {hideTitle}

::: audio /assets/test-audio.mp3
title: Audio title
:::

# Catalog embed {hideTitle}

::: embed https://example.com/embed
:::

# Catalog embed serialized {hideTitle}

::: embed https://example.com/embed
:::

# Catalog bookmark {hideTitle}

::: bookmark [Resource title](https://example.com)
:::

# Catalog bookmark serialized {hideTitle}

::: bookmark [Resource title](https://example.com)
:::

# Catalog button {hideTitle}

::: button [Button text](https://example.com) {style=filled}
:::

# Catalog button serialized {hideTitle}

::: button [Button text](https://example.com) {newTab}
:::

# Catalog data-table {hideTitle}

| Column A | Column B | Column C |
|----------|----------|----------|
| Row 1 A | Row 1 B | Row 1 C |
| Row 2 A | Row 2 B | Row 2 C |

# Catalog data-table serialized {hideTitle}

| Column A | Column B | Column C |
| Row 1 A | Row 1 B | Row 1 C |
| Row 2 A | Row 2 B | Row 2 C |

# Catalog stats {hideTitle}

::: stats {size=default}
| 41% | Describe what the statistic means. |
caption: Source: [Source title](https://example.com)
:::

# Catalog stats serialized {hideTitle}

::: stats {size=default}
| 41% | Describe what the statistic means. |
caption: Source: [Source title](https://example.com)
:::

# Catalog accordion {hideTitle}

::: accordion
:: Before the meeting {level=3}
Send the agenda so everyone knows what to prepare.

:: After the meeting {level=3}
Share the decisions and the tasks each person agreed to complete.
:::

# Catalog accordion serialized {hideTitle}

::: accordion
:: Before the meeting {level=3}
Send the agenda so everyone knows what to prepare.

:: After the meeting {level=3}
Share the decisions and the tasks each person agreed to complete.
:::

# Catalog tabs {hideTitle}

::: tabs
:: Draft {level=3}
Write one sentence that tells the reader what to do.

:: Revise {level=3}
Read the sentence aloud. Replace words that make it hard to follow.
:::

# Catalog tabs serialized {hideTitle}

::: tabs
:: Draft {level=3}
Write one sentence that tells the reader what to do.

:: Revise {level=3}
Read the sentence aloud. Replace words that make it hard to follow.
:::

# Catalog columns {hideTitle}

::: columns
::
### Column one

Content for the first column.

::
### Column two

Content for the second column.
:::

# Catalog columns serialized {hideTitle}

::: columns
::
### Column one

Content for the first column.

::
### Column two

Content for the second column.
:::

# Catalog card {hideTitle}

::: cards {columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# Catalog card serialized {hideTitle}

::: cards {columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# Catalog comparison {hideTitle}

::: comparison {layout=slider}
:: Before {level=3}
![Describe the image before the change](/assets/test-image.webp)

:: After {level=3}
![Describe the image after the change](/assets/test-image-wide.webp)
:::

# Catalog comparison serialized {hideTitle}

::: comparison {layout=slider}
:: Before {level=3}
![Describe the image before the change](/assets/test-image.webp)

:: After {level=3}
![Describe the image after the change](/assets/test-image-wide.webp)
:::

# Catalog sequence {hideTitle}

::: sequence {style=numbered}
:: Prepare the agenda {level=3}
List the topics and the decisions the group needs to make.

:: Share the agenda {level=3}
Send it to everyone attending before the meeting.
:::

# Catalog sequence serialized {hideTitle}

::: sequence {style=numbered}
:: Prepare the agenda {level=3}
List the topics and the decisions the group needs to make.

:: Share the agenda {level=3}
Send it to everyone attending before the meeting.
:::

# Catalog choose-one {hideTitle}

::: choice How can you help participants prepare for the discussion? {scored attempts=2 points=10 level=3}
Choose one answer.
(x) Send the agenda before the meeting.
feedback: An agenda tells participants which topics to prepare.
( ) Send the agenda after the meeting.
feedback: Send it before the meeting so participants have time to prepare.
( ) Share only the meeting time.
feedback: Participants also need to know what the meeting will cover.
:::

# Catalog choose-one serialized {hideTitle}

::: choice How can you help participants prepare for the discussion? {points=10 attempts=2 scored level=3}
Choose one answer.
(x) Send the agenda before the meeting.
feedback: An agenda tells participants which topics to prepare.
( ) Send the agenda after the meeting.
feedback: Send it before the meeting so participants have time to prepare.
( ) Share only the meeting time.
feedback: Participants also need to know what the meeting will cover.
:::

# Catalog choose-many {hideTitle}

::: choice Select all that apply. {scored attempts=2 points=10 level=3}
[x] First correct option
[ ] First incorrect option
[x] Second correct option
[ ] Second incorrect option
:::

# Catalog choose-many serialized {hideTitle}

::: choice Select all that apply. {points=10 attempts=2 scored level=3}
[x] First correct option
[ ] First incorrect option
[x] Second correct option
[ ] Second incorrect option
:::

# Catalog match {hideTitle}

::: match Match items on the left with the right {scored attempts=2 points=10 shuffle level=3}
- Left item 1 -> Right item 1
- Left item 2 -> Right item 2
- Left item 3 -> Right item 3
:::

# Catalog match serialized {hideTitle}

::: match Match items on the left with the right {points=10 shuffle attempts=2 scored level=3}
- Left item 1 -> Right item 1
- Left item 2 -> Right item 2
- Left item 3 -> Right item 3
:::

# Catalog order {hideTitle}

::: order Put these items in the correct order {scored attempts=2 points=10 level=3}
1. First item
2. Second item
3. Third item
4. Fourth item
:::

# Catalog order serialized {hideTitle}

::: order Put these items in the correct order {points=10 attempts=2 scored level=3}
1. First item
2. Second item
3. Third item
4. Fourth item
:::

# Catalog free-response {hideTitle}

::: free-response Your open-ended question here {scored=false attempts=0 level=3}
Provide guidance or context for the learner.
placeholder: Type your response
:::

# Catalog free-response serialized {hideTitle}

::: free-response Your open-ended question here {attempts=0 scored=false level=3}
Provide guidance or context for the learner.
placeholder: Type your response
:::

# Catalog fill-blank {hideTitle}

::: fill-blank Complete the sentence {scored=false attempts=0 level=3}
The answer is {recall|remembering} and it helps learners practice.
:::

# Catalog fill-blank serialized {hideTitle}

::: fill-blank Complete the sentence {attempts=0 scored=false level=3}
The answer is {recall|remembering} and it helps learners practice.
:::

# Catalog categorize {hideTitle}

::: categorize Sort these items into the correct category {scored attempts=2 points=10 shuffle level=3}
:: Category A
- Item belonging to A
- Another item for A
:: Category B
- Item belonging to B
- Another item for B
:::

# Catalog categorize serialized {hideTitle}

::: categorize Sort these items into the correct category {points=10 shuffle attempts=2 scored level=3}
:: Category A
- Item belonging to A
- Another item for A
:: Category B
- Item belonging to B
- Another item for B
:::

# Catalog hotspot {hideTitle}

::: hotspot Select the relevant areas on the image. {scored attempts=2}
![Describe the image](/assets/test-hotspot.webp)
- Correct area {shape=rect x=15 y=20 w=30 h=20 correct}
- Distractor area {shape=polygon points="55 45, 80 45, 80 65, 55 65"}
:::

# Catalog hotspot serialized {hideTitle}

::: hotspot Select the relevant areas on the image. {attempts=2 scored}
![Describe the image](/assets/test-hotspot.webp)
- Correct area {shape=rect x=15 y=20 w=30 h=20 correct}
- Distractor area {shape=polygon points="55 45, 80 45, 80 65, 55 65"}
:::

# Catalog rate {hideTitle}

::: rating How confident are you? {level=3}
1. Not confident
2. Somewhat confident
3. Confident
:::

# Catalog rate serialized {hideTitle}

::: rating How confident are you? {level=3}
1. Not confident
2. Somewhat confident
3. Confident
:::

# Catalog matrix {hideTitle}

::: matrix How confident are you? {scored=false attempts=0 level=3}
1. Not confident
2. Somewhat confident
3. Confident
- Using the first skill
- Using the second skill
:::

# Catalog matrix serialized {hideTitle}

::: matrix How confident are you? {attempts=0 scored=false level=3}
1. Not confident
2. Somewhat confident
3. Confident
- Using the first skill
- Using the second skill
:::

# Catalog assessment-group {hideTitle}

::: group Knowledge check {mode=all showResultsSummary passingScore=80}
::: choice Choose the correct answer {scored attempts=2 points=10}
(x) Correct answer
( ) Incorrect answer
:::
:::

# Catalog assessment-group serialized {hideTitle}

::: group Knowledge check {mode=all showResultsSummary passingScore=80}
::: choice Choose the correct answer {points=10 attempts=2 scored}
(x) Correct answer
( ) Incorrect answer
:::
:::

# Catalog checklist {hideTitle}

::: checklist
- [ ] State the purpose
- [ ] Check the step order
- [ ] Remove repeated points
:::

# Catalog checklist serialized {hideTitle}

::: checklist
- [ ] State the purpose
- [ ] Check the step order
- [ ] Remove repeated points
:::

# Catalog signature {hideTitle}

::: signature Sign to confirm completion {mode=draw level=3}
:::

# Catalog signature serialized {hideTitle}

::: signature Sign to confirm completion {mode=draw required=false level=3}
:::

# Catalog divider {hideTitle}

---

# Catalog divider serialized {hideTitle}

---

# catalog-visual-note-style-outline {hideTitle}

::: note {style=outline tone=note}
Important information for learners.
:::

# catalog-visual-note-style-filled {hideTitle}

::: note {style=shaded tone=note}
Important information for learners.
:::

# catalog-visual-card-style-none {hideTitle}

::: cards {style=none columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-style-outline {hideTitle}

::: cards {style=outline columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-style-shaded {hideTitle}

::: cards {style=shaded columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-style-accent {hideTitle}

::: cards {style=primary columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-shadow-theme {hideTitle}

::: cards {style=outline shadow=theme columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-shadow-none {hideTitle}

::: cards {style=outline shadow=none columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-shadow-subtle {hideTitle}

::: cards {style=outline shadow=subtle columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-shadow-elevated {hideTitle}

::: cards {style=outline shadow=elevated columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-transition-none {hideTitle}

::: cards {layout=slides transition=none columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-transition-fade {hideTitle}

::: cards {layout=slides transition=fade columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-transition-slide {hideTitle}

::: cards {layout=slides transition=slide columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-card-transition-zoom {hideTitle}

::: cards {layout=slides transition=zoom columns=2}
:: Make the next step clear {level=3}
Start with the action you want the reader to take.

:: Keep it focused {level=3}
Include only what the reader needs for that step.
:::

# catalog-visual-button-style-filled {hideTitle}

::: button [Button text](https://example.com) {style=filled}
:::

# catalog-visual-button-style-outline {hideTitle}

::: button [Button text](https://example.com) {style=outline}
:::

# catalog-visual-button-style-light {hideTitle}

::: button [Button text](https://example.com) {style=light}
:::

# catalog-visual-stats-size-default {hideTitle}

::: stats {size=default}
| 41% | Describe what the statistic means. |
caption: Source: [Source title](https://example.com)
:::

# catalog-visual-stats-size-large {hideTitle}

::: stats {size=large}
| 41% | Describe what the statistic means. |
caption: Source: [Source title](https://example.com)
:::

# catalog-visual-stats-size-very-large {hideTitle}

::: stats {size=very-large}
| 41% | Describe what the statistic means. |
caption: Source: [Source title](https://example.com)
:::

# Catalog legacy hotspot {hideTitle}

::: hotspot Catalog legacy hotspot {scored attempts=2 points=10}
![Equipment controls with a valve and gauge](/assets/test-hotspot.webp)
- Valve {x=30 y=40 correct}
- Gauge {x=60 y=50}
:::

# Catalog focus tabs {hideTitle}

::: tabs
:: Understand {level=3}
Read this section before continuing.

:: Review formats {level=3}
Read this section before continuing.

:: Choose a format {level=3}
Read this section before continuing.

:: Check results {level=3}
Read this section before continuing.
:::

# Catalog iconless note {hideTitle}

::: note For sample review {icon=none}
Note text
:::

# Catalog annual chart {hideTitle}

::: table {chart=line showPoints}
| Year | Count |
| --- | --- |
| 1961 | 10 |
| 1962 | 11 |
| 1963 | 12 |
| 1964 | 13 |
| 1965 | 14 |
| 1966 | 15 |
| 1967 | 16 |
| 1968 | 17 |
| 1969 | 18 |
| 1970 | 19 |
| 1971 | 20 |
| 1972 | 21 |
| 1973 | 22 |
| 1974 | 23 |
| 1975 | 24 |
| 1976 | 25 |
| 1977 | 26 |
| 1978 | 27 |
| 1979 | 28 |
| 1980 | 29 |
| 1981 | 30 |
| 1982 | 31 |
| 1983 | 32 |
| 1984 | 33 |
| 1985 | 34 |
| 1986 | 35 |
| 1987 | 36 |
| 1988 | 37 |
| 1989 | 38 |
| 1990 | 39 |
| 1991 | 40 |
| 1992 | 41 |
| 1993 | 42 |
| 1994 | 43 |
| 1995 | 44 |
| 1996 | 45 |
| 1997 | 46 |
| 1998 | 47 |
| 1999 | 48 |
| 2000 | 49 |
| 2001 | 50 |
| 2002 | 51 |
| 2003 | 52 |
| 2004 | 53 |
| 2005 | 54 |
| 2006 | 55 |
| 2007 | 56 |
| 2008 | 57 |
| 2009 | 58 |
| 2010 | 59 |
| 2011 | 60 |
| 2012 | 61 |
| 2013 | 62 |
| 2014 | 63 |
| 2015 | 64 |
| 2016 | 65 |
| 2017 | 66 |
| 2018 | 67 |
| 2019 | 68 |
| 2020 | 69 |
| 2021 | 70 |
title: Annual counts
alt: Annual counts from 1961 to 2021
:::

# Catalog inspect bar chart {hideTitle}

::: table {chart=bar showPoints=false}
| Period | Alpha | Beta |
| --- | --- | --- |
| Q1 | 3 | 5 |
| Q2 | 7 | 4 |
| Q3 | 2 | 8 |
title: Inspect bar data
:::

# Catalog inspect line chart {hideTitle}

::: table {chart=line showPoints=false}
| Period | Alpha | Beta |
| --- | --- | --- |
| Q1 | 3 | 5 |
| Q2 | 7 | 4 |
| Q3 | 2 | 8 |
title: Inspect line data
:::

# Catalog inspect area chart {hideTitle}

::: table {chart=area showPoints=false}
| Period | Alpha | Beta |
| --- | --- | --- |
| Q1 | 3 | 5 |
| Q2 | 7 | 4 |
| Q3 | 2 | 8 |
title: Inspect area data
:::

# Catalog inspect scatter chart {hideTitle}

::: table {chart=scatter showPoints=false}
| Period | Alpha | Beta |
| --- | --- | --- |
| Q1 | 3 | 5 |
| Q2 | 7 | 4 |
| Q3 | 2 | 8 |
title: Inspect scatter data
:::

# Catalog inspect radar chart {hideTitle}

::: table {chart=radar showPoints=false}
| Period | Alpha | Beta |
| --- | --- | --- |
| Q1 | 3 | 5 |
| Q2 | 7 | 4 |
| Q3 | 2 | 8 |
title: Inspect radar data
:::

# Catalog inspect stacked chart {hideTitle}

::: table {chart=stacked showPoints=false}
| Period | Alpha | Beta |
| --- | --- | --- |
| Q1 | 3 | 5 |
| Q2 | 7 | 4 |
| Q3 | 2 | 8 |
title: Inspect stacked data
:::

# Composition assessment choice {hideTitle}

::: group Assessment {mode=oneOf showResultsSummary passingScore=70}
::: choice Which step should you take first? {scored attempts=2 points=10 required shuffle}
A calendar invite has the wrong room. Select the first step.
(x) Pause sending and compare the invite with the room booking
feedback: Correct. Check the source before you send a correction.
( ) Send the invite and correct it later
feedback: Sending the wrong room first creates avoidable confusion.
( ) Ask everyone to choose a room
feedback: Ask for help only after you check the booking details.
:::
::: free-response For team leads, how would you address a recurring scheduling error? {scored=false attempts=0 points=10 required}
A shared invite has shown the wrong room three times this month. Explain how you would find the cause, change the process, and check the next invite.
placeholder: Type your response
:::
:::
