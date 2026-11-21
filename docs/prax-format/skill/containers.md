# Write item containers

Read [item containers](../reference/blocks-containers.md) before changing boundaries. Accordion, tabs, sequence, cards, comparison and columns use `:: Title` items. Close nested blocks before the next item. One closer ends the container and its final item.

Apply [keep required content visible](learners.md#keep-required-content-visible) before choosing a container. For card backs, apply [ask before revealing an answer](learners.md#ask-before-revealing-an-answer).

```prax
# Safety terms

::: cards {layout=slides style=outline}
:: Lockout/tagout
What does it mean?
::: back
Isolate energy before maintenance.
:::
:: Confined space
A space with restricted entry or exit.
:::
```

Accordion, tabs and sequence require item titles. Cards, comparison and columns allow untitled items. Each container needs at least one item; comparison needs exactly two. A card accepts at most one back face.

Put column weights on item openers. Weights are positive finite numbers, including fractions. Keep width on the block distinct from weight on its columns. See the [image comparison pattern](../examples/patterns/image-comparison.prax).

To teach on one laptop-sized slide, put a worked example and one practice question in weighted columns on a page of their own. See the [worked example pattern](../examples/patterns/worked-example-practice/en.prax). Its fit is measured for that example's length; longer slides scroll, and narrow screens stack the columns.

Keep sequence style and orientation separate. Card layout controls grid, masonry, slides or rows; style controls its surface. A title or heading inside one item does not change sibling heading scope. Validate the whole lesson after a move, split or wrap. See [source operations](../reference/operations.md) for tool integration and [validation](validation.md) for author checks.
