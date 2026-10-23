import type { ReactNode } from "react";

interface PanelFieldRowProps {
	columns?: 2 | 3;
	children: ReactNode;
}

export function PanelFieldRow({ columns = 2, children }: PanelFieldRowProps) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: `repeat(${columns}, 1fr)`,
				gap: "var(--panel-grid-gap)",
			}}
		>
			{children}
		</div>
	);
}
