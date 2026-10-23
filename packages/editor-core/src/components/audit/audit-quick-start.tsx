"use client";

import { useTranslations } from "use-intl";
import { AuditIssueCard } from "./audit-issue-card";
import type { AuditIssue } from "./types";

interface AuditQuickStartProps {
	issue: AuditIssue;
	severityLabel: string;
	onNavigate: () => void;
	onDismiss: () => void;
	dismissLabel: string;
	translationNamespace?: string;
	tokenPrefix?: string;
}

export function AuditQuickStart({
	issue,
	severityLabel,
	onNavigate,
	onDismiss,
	dismissLabel,
	translationNamespace = "a11yAudit",
	tokenPrefix = "--praxity-app-a11y",
}: AuditQuickStartProps) {
	const t = useTranslations(translationNamespace);

	return (
		<AuditIssueCard
			issue={issue}
			severityLabel={severityLabel}
			showDismiss
			showRestore={false}
			restoreLabel={t("actions.restore")}
			dismissLabel={dismissLabel}
			onNavigate={onNavigate}
			onDismiss={onDismiss}
			onRestore={() => {}}
			forceGuidanceExpanded
			tokenPrefix={tokenPrefix}
		/>
	);
}
