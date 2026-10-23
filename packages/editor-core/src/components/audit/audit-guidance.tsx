"use client";

import { Box, List, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useId, useState } from "react";
import type { GuidanceContent } from "./types";

interface AuditGuidanceProps {
	rule: string;
	guidance: GuidanceContent | undefined;
	defaultExpanded?: boolean;
}

export function AuditGuidance({ rule, guidance, defaultExpanded = false }: AuditGuidanceProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const id = useId();
	const contentId = `audit-guidance-${rule}-${id}`;

	if (!guidance) return null;

	return (
		<Box>
			<UnstyledButton
				type="button"
				onClick={() => setExpanded((value) => !value)}
				aria-expanded={expanded}
				aria-controls={contentId}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: "var(--mantine-spacing-xs)",
					color: "var(--panel-text)",
					fontSize: "var(--mantine-font-size-xs)",
					fontWeight: 600,
					outline: "none",
				}}
			>
				{expanded ? (
					<IconChevronDown size={14} aria-hidden="true" />
				) : (
					<IconChevronRight size={14} aria-hidden="true" />
				)}
				{guidance.topic}
			</UnstyledButton>
			{expanded ? (
				<Box id={contentId} mt={4}>
					<List spacing={4} size="xs">
						{guidance.bullets.map((bullet) => (
							<List.Item key={bullet}>
								<Text size="xs">{bullet}</Text>
							</List.Item>
						))}
					</List>
				</Box>
			) : null}
		</Box>
	);
}
