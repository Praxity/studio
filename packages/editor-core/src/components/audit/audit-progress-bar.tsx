"use client";

import { Progress, Stack, Text } from "@mantine/core";
import { useTranslations } from "use-intl";

interface AuditProgressBarProps {
	criticalFixed: number;
	criticalTotal: number;
	overallFixed: number;
	overallTotal: number;
	translationNamespace?: string;
}

export function AuditProgressBar({
	criticalFixed,
	criticalTotal,
	overallFixed,
	overallTotal,
	translationNamespace = "a11yAudit",
}: AuditProgressBarProps) {
	const t = useTranslations(translationNamespace);

	if (overallTotal <= 0 || overallFixed <= 0) return null;

	const overallPct = Math.round((overallFixed / Math.max(overallTotal, 1)) * 100);
	const criticalComplete = criticalTotal > 0 && criticalFixed >= criticalTotal;

	return (
		<Stack gap={4}>
			<Text size="xs" fw={600}>
				{t("progress.critical", { fixed: criticalFixed, total: criticalTotal })}
			</Text>
			{criticalComplete ? (
				<Text size="xs" c="dimmed">
					{t("progress.criticalComplete")}
				</Text>
			) : null}
			<Text size="xs" fw={600}>
				{t("progress.overall", { fixed: overallFixed, total: overallTotal })}
			</Text>
			<Progress value={overallPct} size="sm" radius="xl" />
			{overallFixed >= overallTotal ? (
				<Text size="xs" c="dimmed">
					{t("progress.allComplete")}
				</Text>
			) : null}
		</Stack>
	);
}
