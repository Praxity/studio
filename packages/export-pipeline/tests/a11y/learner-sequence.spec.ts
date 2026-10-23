import { expect, test } from "@playwright/test";
import { answerSequenceBlock } from "../scorm-cloud/learner-simulation";

test("learner simulation orders substring and duplicate labels by item identity", async ({
	page,
}) => {
	await page.setContent(`
		<div class="praxity-block" data-block-type="assessment" data-block-id="order">
			<div class="praxity-order-item" data-node-id="cat-2"><span>cat.</span><button aria-label="Move cat. up">Up</button><button aria-label="Move cat. down">Down</button></div>
			<div class="praxity-order-item" data-node-id="a"><span>a</span><button aria-label="Move a up">Up</button><button aria-label="Move a down">Down</button></div>
			<div class="praxity-order-item" data-node-id="cat-1"><span>cat.</span><button aria-label="Move cat. up">Up</button><button aria-label="Move cat. down">Down</button></div>
		</div>
		<script>
			document.addEventListener('click', event => {
				const button = event.target.closest('button');
				if (!button) return;
				const row = button.parentElement;
				if (button.textContent === 'Up' && row.previousElementSibling) {
					row.parentElement.insertBefore(row, row.previousElementSibling);
				} else if (button.textContent === 'Down' && row.nextElementSibling) {
					row.parentElement.insertBefore(row.nextElementSibling, row);
				}
			});
		</script>
	`);
	await answerSequenceBlock(
		page,
		"order",
		[
			{ id: "a", label: "a", correctPosition: 0 },
			{ id: "cat-1", label: "cat.", correctPosition: 1 },
			{ id: "cat-2", label: "cat.", correctPosition: 2 },
		],
		true,
	);
	expect(
		await page
			.locator(".praxity-order-item")
			.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-node-id"))),
	).toEqual(["a", "cat-1", "cat-2"]);
});
