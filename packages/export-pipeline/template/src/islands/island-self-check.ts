import type { loadSelfCheckAsset as loadAsset } from "../self-check-asset";
import type { SelfCheckRuntime } from "../self-check-runtime";
import type {} from "./self-check-implementation";

const {
	getSelfCheckActivationStrings,
	installSelfCheckControls,
	mountSelfCheckRuntime,
	selfCheckRuntime,
	disposeSelfCheckDocument,
} = window.__praxitySelfCheckCore;

export { disposeSelfCheckDocument };

declare const __PRAXITY_SELF_CHECK_BUILD__: string;
export const build = __PRAXITY_SELF_CHECK_BUILD__;

const mounted = new WeakMap<HTMLElement, { consumers: number; release(): void }>();
export async function loadSelfCheckAsset(...args: Parameters<typeof loadAsset>) {
	return (await selfCheckRuntime(args[1] ?? document).support()).loadSelfCheckAsset(...args);
}
function mount(root: HTMLElement, runtime: SelfCheckRuntime): () => void {
	const doc = root.ownerDocument;
	const answer = root.querySelector<HTMLTextAreaElement>("textarea");
	const notice = root.querySelector<HTMLElement>("[data-self-check-notice]");
	const parts = root.querySelector<HTMLElement>("[data-self-check-parts]");
	const button = (action: string) =>
		root.querySelector<HTMLButtonElement>(`[data-self-check-action="${action}"]`);
	const check = button("check"),
		show = button("show-feedback"),
		reset = button("start-over");
	if (!answer || !notice || !parts || !check || !show || !reset) return () => {};
	const blockId = root.dataset.selfCheckId ?? "";
	const owner = doc.defaultView?.__praxitySelfCheckDocument;
	const ui = getSelfCheckActivationStrings(root.lang);
	const controls = installSelfCheckControls(root, answer, notice, runtime);
	const comparison = doc.createElement("div"),
		recovery = doc.createElement("p"),
		retry = doc.createElement("button");
	comparison.dataset.selfCheckComparison = "";
	recovery.dataset.selfCheckRecovery = "";
	recovery.id = `${answer.id}-recovery`;
	retry.type = "button";
	retry.className = check.className;
	retry.style.inlineSize = "auto";
	retry.dataset.selfCheckAction = "retry";
	retry.textContent = ui.selfCheckRetry;
	for (const control of [check, reset, retry])
		control.setAttribute("aria-describedby", recovery.id);
	check.parentElement?.prepend(retry);
	root.append(recovery, comparison);
	let disposed = false;
	const ticket = () => runtime.ticket(() => !disposed);
	let enhancement:
		| Awaited<ReturnType<Awaited<ReturnType<typeof runtime.support>>["enhance"]>>
		| undefined;
	let mounting: Promise<void> | undefined;
	let announcedFailure: string | undefined;
	const activate = (): Promise<void> => {
		const pass = ticket();
		if (!pass.current()) return Promise.resolve();
		if (!mounting)
			mounting = runtime
				.support()
				.then((support) => {
					if (!pass.current() || !runtime.session.read(blockId)?.admitted) {
						mounting = undefined;
						if (!disposed && ticket().current() && runtime.session.read(blockId)?.admitted)
							return activate();
						return;
					}
					const mounted = support.enhance(root, controls, runtime);
					if (!pass.current()) {
						mounted.cleanup();
						mounting = undefined;
						if (!disposed && ticket().current()) return activate();
						return;
					}
					enhancement = mounted;
					runtime.refresh();
				})
				.catch(() => {
					mounting = undefined;
					if (pass.current()) controls.unavailable();
				});
		return mounting;
	};
	const unsubscribe = runtime.subscribe(
		(pass, command) => {
			if (disposed || !pass.current()) return;
			const state = runtime.session.read(blockId);
			if (!state) return;
			if (command?.blockId === blockId && command.type === "start-over") {
				controls.reset(pass);
				if (!pass.current()) return;
			} else if (
				state.origin === "interaction" &&
				runtime.results.get(blockId)?.status === "empty"
			) {
				controls.projectReset(pass);
				if (!pass.current()) return;
			}
			const unavailable = state.outcome === "unavailable";
			if (state.outcome !== "pending") notice.after(recovery);
			if (unavailable && owner?.printFocus() === check) owner.printFocus(retry);
			retry.hidden = !unavailable && doc.activeElement !== retry && owner?.printFocus() !== retry;
			if (unavailable && doc.activeElement === check) {
				pass.call(() => retry.focus());
				if (!pass.current()) return;
			}
			check.hidden = !retry.hidden;
			retry.setAttribute("aria-disabled", String(!unavailable));
			recovery.textContent =
				state.outcome === "pending"
					? ui.selfCheckRestoring
					: state.code === "activity-changed"
						? ui.selfCheckChanged
						: state.code === "saved-state-invalid"
							? ui.selfCheckInvalidState
							: state.code === "comparison-unavailable"
								? ui.selfCheckContact
								: "";
			if (unavailable) controls.unavailable();
			else notice.hidden = true;
			if (state.code && state.code !== announcedFailure) {
				announcedFailure = state.code;
				const region = doc.getElementById("praxity-live-region");
				if (region)
					region.textContent = unavailable ? ui.selfCheckUnavailable : recovery.textContent;
			}
			if (
				state.outcome === "refused" ||
				unavailable ||
				(state.outcome === "pending" && state.origin === "restore")
			)
				reset.hidden = false;
			if (state.ready && state.admitted && runtime.results.has(blockId)) {
				if (enhancement) pass.call(() => enhancement?.project(pass, command));
				else void activate();
			}
			if (!pass.current()) return;
			controls.saveStatus(pass);
		},
		(pass, command) => {
			if (!disposed && command.blockId === blockId) enhancement?.finish(pass, command);
		},
	);
	const input = () => {
		if (ticket().current()) controls.clearError();
	};
	const onCheck = async () => {
		let pass = ticket();
		const state = runtime.session.read(blockId);
		if (
			!pass.current() ||
			["pending", "unavailable"].includes(state?.outcome ?? "") ||
			!controls.validAnswer(pass) ||
			!pass.current()
		)
			return;
		if (!state?.admitted || !runtime.results.has(blockId)) {
			const pending = runtime.session.dispatch({ type: "retry", blockId });
			const admitted = await pending;
			pass = ticket();
			const current = runtime.session.read(blockId);
			// The admission receipt includes queued retries and rejects intervening commands.
			if (
				!pass.current() ||
				!admitted ||
				!current?.ready ||
				["pending", "unavailable", "cancelled"].includes(current.outcome)
			)
				return;
			if (!controls.validAnswer(pass) || !pass.current() || !pending.current()) return;
		}
		pass = ticket();
		await activate();
		if (!pass.current()) return;
		pass.call(() => enhancement?.check(pass));
	};
	const onReset = () => {
		if (ticket().current()) void runtime.session.dispatch({ type: "start-over", blockId });
	};
	const onRetry = () => {
		if (!ticket().current() || runtime.session.read(blockId)?.outcome !== "unavailable") return;
		void runtime.session.dispatch({ type: "retry", blockId });
	};
	const onRetryBlur = () => {
		if (!ticket().current()) return;
		if (runtime.session.read(blockId)?.outcome !== "unavailable" && owner?.printFocus() !== retry) {
			retry.hidden = true;
			check.hidden = false;
		}
	};
	answer.addEventListener("input", input);
	check.addEventListener("click", onCheck);
	reset.addEventListener("click", onReset);
	retry.addEventListener("click", onRetry);
	retry.addEventListener("blur", onRetryBlur);
	const cleanup = () => {
		disposed = true;
		unsubscribe();
		answer.removeEventListener("input", input);
		check.removeEventListener("click", onCheck);
		reset.removeEventListener("click", onReset);
		retry.removeEventListener("click", onRetry);
		retry.removeEventListener("blur", onRetryBlur);
		enhancement?.cleanup();
		controls.cleanup();
		comparison.remove();
		recovery.remove();
		retry.remove();
	};
	if (!ticket().current()) return cleanup;
	for (const control of [check, show, reset]) control.removeAttribute("data-praxity-js-control");
	for (const node of [show, reset, parts])
		if (!node.contains(doc.activeElement)) node.hidden = true;
	const state = runtime.session.read(blockId);
	if (
		state?.outcome === "refused" ||
		state?.outcome === "unavailable" ||
		(state?.outcome === "pending" && state.origin === "restore")
	)
		reset.hidden = false;
	controls.saveStatus(ticket());
	if (!ticket().current()) return cleanup;
	if (root.hasAttribute("data-self-check-context-pending")) {
		check.disabled = true;
		recovery.textContent = ui.selfCheckRefreshing;
	}
	return cleanup;
}
function enhance(root: HTMLElement): () => void {
	let entry = mounted.get(root);
	if (!entry) {
		let cleanup: (() => void) | undefined;
		const reservation = { consumers: 0, release: () => {} };
		entry = reservation;
		mounted.set(root, reservation);
		reservation.release = mountSelfCheckRuntime(root.ownerDocument, (runtime) => {
			cleanup?.();
			cleanup = undefined;
			if (!runtime) {
				if (mounted.get(root) === reservation) mounted.delete(root);
				return;
			}
			const next = mount(root, runtime);
			if (!runtime.ticket().current()) {
				next();
				return;
			}
			cleanup = next;
			const owner = root.ownerDocument.defaultView?.__praxitySelfCheckDocument;
			const current = owner?.loadTicket();
			// Replacement mounts every sibling synchronously before publishing readiness.
			queueMicrotask(() => {
				if (current?.() && owner?.current === runtime) runtime.session.startup("ready");
			});
		});
	}
	++entry.consumers;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--entry.consumers) return;
		if (mounted.get(root) === entry) mounted.delete(root);
		entry.release();
	};
}
export function initSelfCheckEnhancements(scope: ParentNode = document): () => void {
	const roots = [...scope.querySelectorAll<HTMLElement>("[data-self-check]")];
	const doc = roots[0]?.ownerDocument;
	if (doc) selfCheckRuntime(doc);
	const cleanups = roots.map(enhance);
	return () => cleanups.forEach((cleanup) => cleanup());
}
