"use client";

import { Box, Stack, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { DISPLAY_CATEGORY_ORDER } from "../lib/a11y/rule-metadata";
import { type GifFlashAnalysisOptions, useAuditData } from "./a11y/use-audit-data";
import {
	AuditConfirmDialog,
	AuditDismissUndo,
	AuditEmptyState,
	type AuditFilterMode,
	type AuditIssue,
	AuditIssueCard,
	AuditProgressBar,
	AuditQuickStart,
	AuditSeverityFilter,
	DISPLAY_SEVERITY_ORDER,
	type NavigateToIssueRequest,
} from "./audit";
import { resolveAuditEmptyState } from "./audit/resolve-empty-state";
import { useGrammarDocumentStore } from "./grammar-document-store";
import { PanelSection, PanelShell } from "./panel-chrome";

interface A11yAuditPanelProps {
	lessonFilename?: string;
	courseDesign?: Record<string, unknown>;
	hideTitle?: boolean;
	onNavigateToIssue?: (issue: NavigateToIssueRequest) => void;
	gifFlashAnalysis?: GifFlashAnalysisOptions;
}

interface UndoState {
	ids: string[];
	title: string;
	count: number;
}

/** Dismissals survive panel switches but disappear when the Studio process ends. */
const sessionDismissalsByCourse = new Map<string, Set<string>>();

export function A11yAuditPanel({
	lessonFilename,
	courseDesign,
	hideTitle = false,
	onNavigateToIssue,
	gifFlashAnalysis,
}: A11yAuditPanelProps) {
	const t = useTranslations("a11yAudit");
	const courseId = useGrammarDocumentStore((s) => s.courseId);

	const [dismissedIds, setDismissedIds] = useState<Set<string>>(
		() => new Set(sessionDismissalsByCourse.get(courseId)),
	);
	const { state, mediaAnalysisPending, issues, issuesByCategory, counts } = useAuditData({
		lessonFilename,
		courseDesign,
		gifFlashAnalysis,
		dismissedIds,
	});
	const mediaAnalysisRunning = state === "ready" && mediaAnalysisPending;
	const [filterMode, setFilterMode] = useState<AuditFilterMode>("severity");
	const [activeSeverities, setActiveSeverities] = useState(() => new Set(DISPLAY_SEVERITY_ORDER));
	const [quickStartHidden, setQuickStartHidden] = useState(false);
	const [visitedIssueId, setVisitedIssueId] = useState<string | null>(null);
	const [confirmIssue, setConfirmIssue] = useState<AuditIssue | null>(null);
	const [undoState, setUndoState] = useState<UndoState | null>(null);
	const [liveMessage, setLiveMessage] = useState("");
	const undoButtonRef = useRef<HTMLButtonElement | null>(null);
	const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastDismissAtRef = useRef(0);
	const initialIssuesRef = useRef<Map<string, AuditIssue["displaySeverity"]> | null>(null);
	const mediaAnalysisWasPendingRef = useRef(false);
	const previousCourseIdRef = useRef<string | null>(null);
	const updateDismissedIds = (update: (current: Set<string>) => Set<string>) => {
		setDismissedIds((current) => {
			const next = update(current);
			sessionDismissalsByCourse.set(courseId, next);
			return next;
		});
	};

	useEffect(() => {
		if (previousCourseIdRef.current === courseId) return;
		previousCourseIdRef.current = courseId;
		setFilterMode("severity");
		setActiveSeverities(new Set(DISPLAY_SEVERITY_ORDER));
		setQuickStartHidden(false);
		setVisitedIssueId(null);
		setUndoState(null);
		setDismissedIds(new Set(sessionDismissalsByCourse.get(courseId)));
		initialIssuesRef.current = null;
		mediaAnalysisWasPendingRef.current = false;
	}, [courseId]);

	useEffect(() => {
		if (state !== "ready" || mediaAnalysisRunning || initialIssuesRef.current) return;
		const initial = new Map<string, AuditIssue["displaySeverity"]>();
		for (const issue of issues) {
			if (!initial.has(issue.annotationId)) {
				initial.set(issue.annotationId, issue.displaySeverity);
			}
		}
		initialIssuesRef.current = initial;
	}, [issues, mediaAnalysisRunning, state]);

	const announce = useCallback((message: string) => {
		if (liveTimerRef.current) {
			clearTimeout(liveTimerRef.current);
		}
		liveTimerRef.current = setTimeout(() => {
			setLiveMessage(message);
		}, 300);
	}, []);

	useEffect(() => {
		if (state !== "ready") {
			mediaAnalysisWasPendingRef.current = false;
			return;
		}
		if (mediaAnalysisRunning) {
			if (!mediaAnalysisWasPendingRef.current) announce(t("live.mediaAnalysisPending"));
			mediaAnalysisWasPendingRef.current = true;
		} else if (mediaAnalysisWasPendingRef.current) {
			announce(t("live.mediaAnalysisComplete"));
			mediaAnalysisWasPendingRef.current = false;
		}
	}, [announce, mediaAnalysisRunning, state, t]);

	useEffect(() => {
		return () => {
			if (liveTimerRef.current) {
				clearTimeout(liveTimerRef.current);
			}
		};
	}, []);

	const openIssues = useMemo(() => issues.filter((issue) => !issue.isDismissed), [issues]);

	const quickStartIssue = useMemo(() => {
		if (filterMode === "dismissed" || quickStartHidden) return null;
		const candidatePool = openIssues.filter((issue) => activeSeverities.has(issue.displaySeverity));
		return (
			candidatePool.find((issue) => issue.displaySeverity === "critical") ??
			candidatePool.find((issue) => issue.displaySeverity === "recommended") ??
			null
		);
	}, [activeSeverities, filterMode, openIssues, quickStartHidden]);

	const filteredIssues = useMemo(() => {
		const base =
			filterMode === "dismissed"
				? issues.filter((issue) => issue.isDismissed)
				: issues.filter(
						(issue) => !issue.isDismissed && activeSeverities.has(issue.displaySeverity),
					);
		if (!quickStartIssue || filterMode === "dismissed") return base;
		return base.filter(
			(issue) =>
				!(
					issue.annotationId === quickStartIssue.annotationId &&
					issue.rule === quickStartIssue.rule &&
					issue.blockId === quickStartIssue.blockId
				),
		);
	}, [activeSeverities, filterMode, issues, quickStartIssue]);

	const filteredByCategory = useMemo(() => {
		const byCategory: Record<string, AuditIssue[]> = {};
		for (const category of DISPLAY_CATEGORY_ORDER) {
			byCategory[category] = [];
		}
		for (const issue of filteredIssues) {
			byCategory[issue.category].push(issue);
		}
		return byCategory;
	}, [filteredIssues]);

	const hasOpenIssues = openIssues.length > 0;
	const hasDismissedIssues = counts.dismissed > 0;
	const hasFilteredIssues = filteredIssues.length > 0;

	const progress = useMemo(() => {
		const initial = initialIssuesRef.current;
		if (!initial) {
			return { criticalFixed: 0, criticalTotal: 0, overallFixed: 0, overallTotal: 0 };
		}

		const currentIds = new Set(issues.map((issue) => issue.annotationId));
		let criticalFixed = 0;
		let criticalTotal = 0;
		let overallFixed = 0;
		let overallTotal = 0;

		for (const [annotationId, severity] of initial.entries()) {
			overallTotal += 1;
			if (severity === "critical") {
				criticalTotal += 1;
			}
			if (!currentIds.has(annotationId)) {
				overallFixed += 1;
				if (severity === "critical") {
					criticalFixed += 1;
				}
			}
		}

		return { criticalFixed, criticalTotal, overallFixed, overallTotal };
	}, [issues]);

	const dismissWithUndo = (issue: AuditIssue) => {
		updateDismissedIds((current) => new Set(current).add(issue.annotationId));
		const now = Date.now();
		const shouldMerge = now - lastDismissAtRef.current <= 500 && undoState;
		lastDismissAtRef.current = now;

		if (shouldMerge) {
			const mergedIds = Array.from(new Set([...undoState.ids, issue.annotationId]));
			setUndoState({
				ids: mergedIds,
				title: undoState.title,
				count: undoState.count + 1,
			});
		} else {
			setUndoState({
				ids: [issue.annotationId],
				title: issue.title,
				count: 1,
			});
		}

		announce(t("live.dismissed", { title: issue.title }));
		setTimeout(() => {
			undoButtonRef.current?.focus();
		}, 0);
	};

	const handleDismiss = (issue: AuditIssue) => {
		if (issue.displaySeverity === "critical") {
			setConfirmIssue(issue);
			return;
		}
		dismissWithUndo(issue);
	};

	const handleRestore = (issue: AuditIssue) => {
		updateDismissedIds((current) => {
			const next = new Set(current);
			next.delete(issue.annotationId);
			return next;
		});
		announce(t("live.restored", { title: issue.title }));
	};

	const handleUndo = () => {
		if (!undoState) return;
		updateDismissedIds((current) => {
			const next = new Set(current);
			for (const id of undoState.ids) next.delete(id);
			return next;
		});
		setUndoState(null);
		announce(t("live.undo"));
	};

	const handleNavigate = (issue: AuditIssue, fromQuickStart = false) => {
		setVisitedIssueId(issue.annotationId);
		if (fromQuickStart) {
			setQuickStartHidden(true);
		}
		setUndoState(null);
		announce(t("live.navigated", { reference: issue.blockReference }));
		onNavigateToIssue?.({
			annotationId: issue.annotationId,
			rule: issue.rule,
			title: issue.title,
			fixDomain: issue.fixDomain,
			blockId: issue.blockId,
			pageId: issue.pageId,
			documentId: issue.documentId,
			documentTitle: issue.documentTitle,
			sourceLine: issue.sourceLine,
			isCurrentSource: issue.isCurrentSource,
		});
	};

	const handleSeverityToggle = (severity: AuditIssue["displaySeverity"]) => {
		setFilterMode("severity");
		setUndoState(null);
		setActiveSeverities((previous) => {
			const next = new Set(previous);
			if (next.has(severity)) {
				next.delete(severity);
			} else {
				next.add(severity);
			}
			return next;
		});
		announce(t("live.filtersUpdated"));
	};

	const handleDismissedMode = () => {
		setFilterMode("dismissed");
		setUndoState(null);
		announce(t("live.dismissedFilter"));
	};

	const emptyStateType = mediaAnalysisRunning
		? null
		: resolveAuditEmptyState({
				state,
				issues,
				hasOpenIssues,
				hasDismissedIssues,
				filterMode,
				hasFilteredIssues,
				hasQuickStartIssue: Boolean(quickStartIssue),
			});
	const emptyState = emptyStateType ? <AuditEmptyState type={emptyStateType} /> : null;
	let renderedCategoryCount = 0;
	const categorySections = DISPLAY_CATEGORY_ORDER.map((category) => {
		const categoryIssues =
			filterMode === "dismissed"
				? issuesByCategory[category].filter((issue) => issue.isDismissed)
				: (filteredByCategory[category] ?? []);
		if (categoryIssues.length === 0) return null;

		const first = renderedCategoryCount === 0 && !quickStartIssue && !undoState;
		renderedCategoryCount += 1;

		return (
			<PanelSection
				key={category}
				title={t(`categories.${category}`)}
				description={t("issuesCount", { count: categoryIssues.length })}
				first={first}
			>
				<Stack gap="xs">
					{categoryIssues.map((issue) => (
						<AuditIssueCard
							key={`${issue.annotationId}-${issue.rule}-${issue.blockId ?? issue.pageId ?? "course"}`}
							issue={issue}
							severityLabel={t(`severity.${issue.displaySeverity}`)}
							showDismiss={filterMode !== "dismissed"}
							showRestore={filterMode === "dismissed"}
							restoreLabel={t("actions.restore")}
							dismissLabel={t("actions.dismiss")}
							onNavigate={() => handleNavigate(issue)}
							onDismiss={() => handleDismiss(issue)}
							onRestore={() => handleRestore(issue)}
							isVisited={visitedIssueId === issue.annotationId}
						/>
					))}
				</Stack>
			</PanelSection>
		);
	});

	return (
		<PanelShell
			title={hideTitle ? undefined : t("title")}
			header={
				<>
					<div
						role="status"
						aria-live="polite"
						aria-atomic="true"
						style={{
							position: "absolute",
							width: 1,
							height: 1,
							overflow: "hidden",
							clip: "rect(0,0,0,0)",
							whiteSpace: "nowrap",
						}}
					>
						{liveMessage}
					</div>

					<Stack gap="xs">
						{mediaAnalysisRunning ? (
							<Text size="xs" c="dimmed">
								{t("states.mediaAnalysisPending")}
							</Text>
						) : null}

						<AuditSeverityFilter
							counts={counts}
							filterMode={filterMode}
							activeSeverities={activeSeverities}
							onToggleSeverity={handleSeverityToggle}
							onSetDismissedMode={handleDismissedMode}
						/>

						{mediaAnalysisRunning ? null : (
							<AuditProgressBar
								criticalFixed={progress.criticalFixed}
								criticalTotal={progress.criticalTotal}
								overallFixed={progress.overallFixed}
								overallTotal={progress.overallTotal}
							/>
						)}
					</Stack>
				</>
			}
		>
			{emptyState ? (
				<Box>{emptyState}</Box>
			) : (
				<Box>
					{quickStartIssue ? (
						<AuditQuickStart
							issue={quickStartIssue}
							severityLabel={t(`severity.${quickStartIssue.displaySeverity}`)}
							onNavigate={() => handleNavigate(quickStartIssue, true)}
							onDismiss={() => {
								setQuickStartHidden(true);
								handleDismiss(quickStartIssue);
							}}
							dismissLabel={t("actions.dismiss")}
						/>
					) : null}

					{undoState ? (
						<PanelSection title={t("actions.undo")} first={!quickStartIssue}>
							<AuditDismissUndo
								label={
									undoState.count > 1
										? t("undo.multiple", { count: undoState.count })
										: t("undo.single", { title: undoState.title })
								}
								undoLabel={t("actions.undo")}
								onUndo={handleUndo}
								undoRef={(node) => {
									undoButtonRef.current = node;
								}}
							/>
						</PanelSection>
					) : null}

					{categorySections}
				</Box>
			)}

			<AuditConfirmDialog
				opened={confirmIssue !== null}
				title={t("confirmCritical.title")}
				body={t("confirmCritical.body")}
				cancelLabel={t("actions.cancel")}
				confirmLabel={t("actions.dismiss")}
				onCancel={() => setConfirmIssue(null)}
				onConfirm={() => {
					if (confirmIssue) {
						dismissWithUndo(confirmIssue);
					}
					setConfirmIssue(null);
				}}
			/>
		</PanelShell>
	);
}
