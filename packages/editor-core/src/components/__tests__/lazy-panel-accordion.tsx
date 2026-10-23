import { type ReactNode, useState } from "react";

interface Section {
	id: string;
	label: string;
	content: ReactNode;
}

// These suites exercise panel controls; mount only the open section to keep them fast.
export function LazyPanelAccordion({ sections }: { sections: Section[] }) {
	const [openId, setOpenId] = useState<string | null>(sections[0]?.id ?? null);
	return (
		<div>
			{sections.map(({ id, label, content }) => (
				<div key={id}>
					<button
						type="button"
						aria-expanded={openId === id}
						onClick={() => setOpenId((current) => (current === id ? null : id))}
					>
						{label}
					</button>
					{openId === id ? content : null}
				</div>
			))}
		</div>
	);
}
