"use client";

import { Button, Group, Text } from "@mantine/core";

interface AuditDismissUndoProps {
	label: string;
	undoLabel: string;
	onUndo: () => void;
	undoRef?: (node: HTMLButtonElement | null) => void;
}

export function AuditDismissUndo({ label, undoLabel, onUndo, undoRef }: AuditDismissUndoProps) {
	return (
		<Group
			justify="space-between"
			p="sm"
			style={{
				border: "1px dashed var(--panel-control-border-color)",
				borderRadius: "var(--mantine-radius-md)",
			}}
		>
			<Text size="xs">{label}</Text>
			<Button ref={undoRef} size="xs" variant="light" onClick={onUndo}>
				{undoLabel}
			</Button>
		</Group>
	);
}
