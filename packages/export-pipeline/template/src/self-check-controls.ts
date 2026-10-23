import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import {
	getSelfCheckActivationStrings,
	getSelfCheckHostStrings,
} from "@praxity/shared-blocks/i18n/self-check-host-strings";
import type { SelfCheckEffectTicket, SelfCheckRuntime } from "./self-check-runtime";
// Reset projection belongs to the document owner, outside the lazy comparison adapter.
export type SelfCheckControls = Omit<ReturnType<typeof installSelfCheckControls>, "projectReset">;
export function installSelfCheckControls(
	root: HTMLElement,
	answer: HTMLTextAreaElement,
	notice: HTMLElement,
	runtime: SelfCheckRuntime,
) {
	const doc = root.ownerDocument,
		blockId = root.dataset.selfCheckId ?? "";
	const locale = resolveLocale(root.lang),
		host = getSelfCheckHostStrings(locale),
		ui = getSelfCheckActivationStrings(locale);
	const error = root.querySelector<HTMLElement>("[data-self-check-error]");
	if (!error) throw new Error("ESELFCHECKCONTROL");
	const mode = doc.createElement("p"),
		saveNotice = doc.createElement("p");
	mode.dataset.selfCheckMode = "";
	mode.id = `${answer.id}-mode`;
	saveNotice.dataset.selfCheckSave = "";
	saveNotice.id = `${answer.id}-save`;
	notice.after(mode, saveNotice);
	let comparisonUnavailable = false;
	const describeAnswer = (
		descriptions: HTMLElement[] = [
			...(comparisonUnavailable && !notice.hidden ? [notice] : []),
			mode,
			...(saveNotice.textContent ? [saveNotice] : []),
		],
	) => {
		answer.setAttribute(
			"aria-describedby",
			[...descriptions, ...(error.hidden ? [] : [error])].map((node) => node.id).join(" "),
		);
	};
	describeAnswer();
	const saveStatus = (ticket = runtime.ticket(), pending = false) => {
		const destination = ticket.call(
			() =>
				runtime.provider?.getReportingDestination?.(blockId) ??
				runtime.provider?.getPolicy?.(blockId),
		);
		if (!ticket.current()) return;
		const saved = pending
			? { status: "not-saved" as const }
			: ticket.call(() => runtime.provider?.getSaveResult?.(blockId));
		if (!ticket.current()) return;
		mode.textContent =
			destination === "lms"
				? host.selfCheckLmsNotice
				: saved?.status === "saved"
					? host.selfCheckDeviceNotice
					: ui.selfCheckDeviceMode;
		saveNotice.textContent =
			saved?.status === "saved"
				? destination === "lms" && saved.destination === "device"
					? ui.selfCheckSavedDevice
					: ""
				: saved?.status === "not-saved" || !runtime.provider
					? destination === "lms"
						? host.selfCheckNotSavedLms
						: host.selfCheckNotSavedDevice
					: "";
		describeAnswer();
	};
	const clearError = () => {
		error.hidden = true;
		answer.removeAttribute("aria-invalid");
		describeAnswer();
	};
	const validAnswer = (ticket = runtime.ticket()) => {
		if (!ticket.current()) return false;
		if (answer.value.trim()) {
			clearError();
			return true;
		}
		error.hidden = false;
		answer.setAttribute("aria-invalid", "true");
		describeAnswer();
		ticket.call(() => answer.focus());
		return false;
	};

	const projectReset = (ticket: SelfCheckEffectTicket) => {
		if (!ticket.current()) return;
		clearError();
		root.querySelectorAll<HTMLInputElement>("[data-self-check-parts] input").forEach((input) => {
			input.checked = false;
		});
		for (const node of root.querySelectorAll<HTMLElement>(
			'[data-self-check-parts], [data-self-check-action="show-feedback"], [data-self-check-action="start-over"]',
		))
			node.hidden = true;
		for (const node of root.querySelectorAll<HTMLElement>(
			"[data-self-check-comparison], [data-self-check-recovery], [data-self-check-status]",
		))
			node.replaceChildren();
		saveStatus(ticket);
	};

	return {
		projectReset,
		saveStatus,
		unavailable() {
			root.querySelector(".praxity-assessment-actions")?.after(mode, saveNotice);
			comparisonUnavailable = true;
			notice.hidden = false;
			notice.textContent = ui.selfCheckUnavailable;
			describeAnswer();
			const reset = root.querySelector<HTMLButtonElement>('[data-self-check-action="start-over"]');
			if (reset && runtime.session.read(blockId)?.origin !== "fresh") reset.hidden = false;
		},
		reset(ticket: SelfCheckEffectTicket = runtime.ticket()) {
			if (!ticket.current()) return;
			answer.value = "";
			ticket.call(() => answer.focus());
			if (!ticket.current()) return;
			projectReset(ticket);
		},

		clearError,
		validAnswer,
		cleanup() {
			// A repeated cleanup must not overwrite a replacement's association with the same IDs.
			if (
				doc.getElementById(mode.id) === mode &&
				answer.getAttribute("aria-describedby")?.split(/\s+/).includes(mode.id)
			)
				describeAnswer([notice]);
			mode.remove();
			saveNotice.remove();
		},
	};
}
