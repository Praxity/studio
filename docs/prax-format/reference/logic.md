# Variables and logic

Start variables in frontmatter. Refer to blocks with their name setting. A rule block has one if part, optional and or or parts, then one or more then parts. Keep and and or in separate rules.

```prax
---
title: Safety check
variables:
  attempts: 0
  learnerName: Learner
---

# Check your equipment

Welcome, {{learnerName}}.

::: choice Which item protects your head? {name=safetyCheck}
(x) Hard hat
( ) Ear protection
:::

::: rule
if: block:safetyCheck.result isNot "correct"
then: disableCompletion because "Submit a correct answer before continuing."
:::
```

Conditions accept is, isNot, >, <, >=, <=, contains, isEmpty, isNotEmpty and isAnyOf. Block fields use `block:name.field`. Variable names start with an ASCII letter and continue with letters, digits or hyphens. Names are case-sensitive. Values can be strings, numbers or booleans.

| Action | Form |
|---|---|
| Show or hide named blocks | show @name, @other; hide @name, @other |
| Require named blocks | require @name, @other |
| Jump | jump @name |
| Set a variable | set attempts = 0 |
| Change a number | add attempts + 1; subtract attempts - 1 |
| Gate forward navigation | disableCompletion because "Complete the check before continuing." |

The optional because clause is a JSON double-quoted string. Escape quotes, backslashes and control characters with JSON escapes. The reason explains the unavailable Continue control. Without a reason, a localized fallback cannot describe your prerequisite.

Conditional visibility uses braces, as in `::: note Hint {visible="attempts >= 3"}`. Put learner text in the body. Use hide for initially hidden content shown by rules.

Course validation checks referenced variables, block names and fields. Unknown actions fail visibly. Use the [Continue gate pattern](../examples/patterns/continue-gate.prax) and [scenario feedback pattern](../examples/patterns/scenario-feedback.prax) for complete examples. Guided module decks and static PDF workbooks refuse unsupported dynamic logic.
