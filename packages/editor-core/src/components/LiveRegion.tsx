import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Effect } from "../session/types";

interface LiveRegionProps {
	message: ReactNode;
	language?: string;
	delayMs?: number;
	politeness?: "polite" | "assertive";
	announcementId?: number;
	isActive?: () => boolean;
	onDelivered?: () => void;
}

const VISUALLY_HIDDEN_STYLE: React.CSSProperties = {
	border: 0,
	clip: "rect(0 0 0 0)",
	height: "1px",
	margin: "-1px",
	overflow: "hidden",
	padding: 0,
	position: "absolute",
	width: "1px",
	whiteSpace: "nowrap",
};

export function LiveRegion({
	message,
	politeness = "polite",
	announcementId,
	language,
	delayMs = 150,
	isActive,
	onDelivered,
}: LiveRegionProps) {
	const [announced, setAnnounced] = useState({
		message: null as ReactNode,
		language,
		politeness,
		onDelivered: undefined as (() => void) | undefined,
	});
	const queue = useRef<LiveRegionProps[]>([]);
	const timeoutRef = useRef<number | null>(null);

	useEffect(() => {
		void announcementId;

		if (!message || isActive?.() === false) return;
		queue.current.push({ message, language, politeness, delayMs, onDelivered });
		function next() {
			const entry = queue.current.shift();
			if (!entry) {
				timeoutRef.current = null;
				return;
			}
			const metadata = { language: entry.language, politeness: entry.politeness ?? "polite" };
			setAnnounced({ ...metadata, message: "", onDelivered: undefined });
			timeoutRef.current = window.setTimeout(
				() => {
					if (isActive?.() === false) return;
					setAnnounced({ ...metadata, message: entry.message, onDelivered: entry.onDelivered });
					// Keep a queued result present before clearing for the next one.
					// Each entry keeps its own language, urgency and focus delay.
					timeoutRef.current = queue.current.length ? window.setTimeout(next, 150) : null;
				},
				Math.max(150, entry.delayMs ?? 150),
			);
		}
		if (timeoutRef.current === null) next();
	}, [announcementId, message, delayMs, language, politeness, isActive, onDelivered]);
	useLayoutEffect(() => {
		if (announced.message && isActive?.() !== false) announced.onDelivered?.();
	}, [announced, isActive]);

	useLayoutEffect(
		() => () => {
			if (timeoutRef.current !== null) {
				window.clearTimeout(timeoutRef.current);
				timeoutRef.current = null;
			}
			queue.current = [];
			setAnnounced((previous) => ({ ...previous, message: null }));
		},
		[],
	);

	return (
		<div
			lang={announced.language}
			aria-live={announced.politeness}
			aria-atomic="true"
			role={announced.politeness === "assertive" ? "alert" : "status"}
			style={VISUALLY_HIDDEN_STYLE}
		>
			{announced.message}
		</div>
	);
}

export type AnnouncementEffect = Extract<Effect, { type: "announce" }>;
/** A1/A8: the new shell feeds only controller effects, through its interface translator. */
export function SessionLiveRegion({
	announcement,
	translate,
	isActive,
	onDelivered,
}: {
	announcement: AnnouncementEffect | null;
	translate: (
		key: string,
		params: Record<string, string | number>,
		language: "en" | "fr",
	) => string;
	isActive?: () => boolean;
	onDelivered?: (announcement: AnnouncementEffect) => void;
}) {
	const [entry, setEntry] = useState<LiveRegionProps>({ message: null });
	const seen = useRef(new WeakSet<AnnouncementEffect>());
	useEffect(() => {
		if (!announcement || isActive?.() === false || seen.current.has(announcement)) return;
		seen.current.add(announcement);
		const params = { ...announcement.message.params };
		const quotes = announcement.courseParams.filter((key) => typeof params[key] === "string");
		quotes.forEach((key, index) => {
			params[key] = `\uE000${index}\uE001`;
		});
		const text = translate(announcement.message.key, params, announcement.interfaceLanguage);
		const parts = text.split(/(\uE000\d+\uE001)/u);
		let delivered = false;
		setEntry({
			onDelivered: () => {
				if (delivered) return;
				delivered = true;
				onDelivered?.(announcement);
			},
			politeness: announcement.level,
			language: announcement.interfaceLanguage,
			delayMs: announcement.delayMs,
			message: parts.map((part, index) => {
				const match = /^\uE000(\d+)\uE001$/u.exec(part);
				if (!match) return part;
				const key = quotes[Number(match[1])];
				if (key === undefined) throw new Error("Unknown course announcement parameter");
				return (
					<span key={`${index}-${key}`} lang={announcement.courseLanguage}>
						{announcement.message.params[key]}
					</span>
				);
			}),
		});
	}, [announcement, translate, isActive, onDelivered]);
	return <LiveRegion {...entry} isActive={isActive} />;
}
