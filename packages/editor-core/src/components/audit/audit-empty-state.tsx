"use client";

import { Center, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";
import { useTranslations } from "use-intl";

export type AuditEmptyStateType =
	| "noContent"
	| "running"
	| "zeroIssues"
	| "noFilteredIssues"
	| "allDismissed"
	| "parseError";

interface AuditEmptyStateProps {
	type: AuditEmptyStateType;
	translationNamespace?: string;
}

export function AuditEmptyState({
	type,
	translationNamespace = "a11yAudit",
}: AuditEmptyStateProps) {
	const t = useTranslations(translationNamespace);

	if (type === "running") {
		return (
			<Stack gap="sm">
				<Text size="sm" fw={600}>
					{t("states.running")}
				</Text>
				<Skeleton height={72} radius="md" />
				<Skeleton height={72} radius="md" />
				<Skeleton height={72} radius="md" />
			</Stack>
		);
	}

	const message =
		type === "noContent"
			? t("states.noContent")
			: type === "zeroIssues"
				? t("states.zeroIssues")
				: type === "noFilteredIssues"
					? t("states.noFilteredIssues")
					: type === "allDismissed"
						? t("states.allDismissed")
						: t("states.parseError");

	const isSuccess = type === "zeroIssues";

	return (
		<Center h="100%">
			<Stack align="center" gap="sm" maw={320}>
				<ThemeIcon size={36} radius="xl" variant="light" color={isSuccess ? "teal" : "gray"}>
					{isSuccess ? (
						<IconCircleCheck size={18} aria-hidden="true" />
					) : (
						<IconInfoCircle size={18} aria-hidden="true" />
					)}
				</ThemeIcon>
				<Text size="sm" c="dimmed" ta="center">
					{message}
				</Text>
			</Stack>
		</Center>
	);
}
