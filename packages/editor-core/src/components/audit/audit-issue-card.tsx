"use client";

import { Badge, Box, Group, Text, UnstyledButton } from "@mantine/core";
import { IconRotateClockwise, IconX } from "@tabler/icons-react";
import { useMemo } from "react";
import { AuditGuidance } from "./audit-guidance";
import type { AuditIssue } from "./types";

interface AuditIssueCardProps {
	issue: AuditIssue;
	severityLabel: string;
	showDismiss: boolean;
	showRestore: boolean;
	restoreLabel: string;
	dismissLabel: string;
	onNavigate: () => void;
	onDismiss: () => void;
	onRestore: () => void;
	forceGuidanceExpanded?: boolean;
	isVisited?: boolean;
	tokenPrefix?: string;
}

function getSeverityToken(
	severity: AuditIssue["displaySeverity"],
): "critical" | "recommended" | "minor" {
	if (severity === "critical") return "critical";
	if (severity === "minor") return "minor";
	return "recommended";
}

export function AuditIssueCard({
	issue,
	severityLabel,
	showDismiss,
	showRestore,
	restoreLabel,
	dismissLabel,
	onNavigate,
	onDismiss,
	onRestore,
	forceGuidanceExpanded = false,
	isVisited = false,
	tokenPrefix = "--praxity-app-a11y",
}: AuditIssueCardProps) {
	const blockRefId = useMemo(
		() => `audit-ref-${issue.annotationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
		[issue.annotationId],
	);
	const severityToken = getSeverityToken(issue.displaySeverity);

	return (
		<Box
			component="article"
			p="sm"
			pr="xl"
			onKeyDown={(event) => {
				if (event.key === "Delete" && showDismiss) {
					event.preventDefault();
					onDismiss();
				}
			}}
			style={{
				// Was `--praxity-editor-*`, a hardcoded One-Dark/One-Light palette
				// scoped to `[data-editor-theme]`. The desktop app never sets that
				// attribute, so every one of these resolved to nothing: the cards had
				// no border and no surface, and the visited/dismissed states were
				// invisible. `--panel-*` cascades from the active desktop theme.
				border: issue.isDismissed
					? "1px dashed var(--panel-control-border-color)"
					: "1px solid var(--panel-control-border-color)",
				borderRadius: "var(--mantine-radius-md)",
				background: isVisited ? "var(--selected-bg)" : "var(--panel-control-bg)",
				opacity: issue.isDismissed ? 0.72 : 1,
				position: "relative",
			}}
		>
			<Group gap={6} mb={6}>
				<Badge
					variant="filled"
					color="gray"
					size="sm"
					aria-hidden="true"
					style={{
						background: `var(${tokenPrefix}-${severityToken}-badge-bg)`,
						// White failed on the lighter severity fills; the badge text is
						// now derived alongside the badge background.
						color: `var(${tokenPrefix}-${severityToken}-badge-text)`,
					}}
				>
					{severityLabel}
				</Badge>
			</Group>

			<UnstyledButton
				type="button"
				data-a11y-issue-id={issue.annotationId}
				onClick={onNavigate}
				aria-label={`${severityLabel} - ${issue.title}`}
				aria-describedby={blockRefId}
				style={{
					display: "block",
					width: "100%",
					textAlign: "left",
					outline: "none",
					fontSize: "var(--mantine-font-size-sm)",
					fontWeight: 600,
					color: "var(--panel-text)",
				}}
			>
				{issue.title}
			</UnstyledButton>

			<Text size="xs" mt={4}>
				{issue.description}
			</Text>

			<Box mt={8}>
				<AuditGuidance
					rule={issue.rule}
					guidance={issue.guidance}
					defaultExpanded={forceGuidanceExpanded || issue.displaySeverity === "critical"}
				/>
			</Box>

			<Text id={blockRefId} size="xs" c="dimmed" mt={8}>
				{issue.blockReference}
			</Text>

			{showDismiss ? (
				<UnstyledButton
					type="button"
					onClick={onDismiss}
					aria-label={`${dismissLabel}: ${issue.title}`}
					aria-keyshortcuts="Delete"
					style={{
						position: "absolute",
						top: "var(--mantine-spacing-xs)",
						right: "var(--mantine-spacing-xs)",
						width: 24,
						height: 24,
						borderRadius: "var(--mantine-radius-sm)",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--panel-text-secondary)",
					}}
				>
					<IconX size={14} aria-hidden="true" />
				</UnstyledButton>
			) : null}

			{showRestore ? (
				<UnstyledButton
					type="button"
					onClick={onRestore}
					aria-label={`${restoreLabel}: ${issue.title}`}
					style={{
						position: "absolute",
						top: "var(--mantine-spacing-xs)",
						right: "var(--mantine-spacing-xs)",
						width: 24,
						height: 24,
						borderRadius: "var(--mantine-radius-sm)",
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--panel-text-secondary)",
					}}
				>
					<IconRotateClockwise size={14} aria-hidden="true" />
				</UnstyledButton>
			) : null}
		</Box>
	);
}
