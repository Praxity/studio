"use client";

import { Button, Group, Modal, Stack, Text } from "@mantine/core";

interface AuditConfirmDialogProps {
	opened: boolean;
	title: string;
	body: string;
	cancelLabel: string;
	confirmLabel: string;
	onCancel: () => void;
	onConfirm: () => void;
}

export function AuditConfirmDialog({
	opened,
	title,
	body,
	cancelLabel,
	confirmLabel,
	onCancel,
	onConfirm,
}: AuditConfirmDialogProps) {
	return (
		<Modal
			opened={opened}
			onClose={onCancel}
			title={title}
			centered
			withCloseButton={false}
			closeOnEscape
			closeOnClickOutside={false}
			trapFocus
			returnFocus
		>
			<Stack gap="md">
				<Text size="sm">{body}</Text>
				<Group justify="flex-end">
					<Button variant="default" onClick={onCancel} autoFocus>
						{cancelLabel}
					</Button>
					<Button
						color="red"
						onClick={onConfirm}
						// The destructive fill is `--status-error`, not the accent, so the
						// label comes from the critical severity pair rather than the
						// accent-text default applied to filled buttons.
						style={{
							background: "var(--severity-critical-badge-bg)",
							color: "var(--severity-critical-badge-text)",
						}}
					>
						{confirmLabel}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
