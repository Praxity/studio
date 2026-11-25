import { MantineProvider } from "@mantine/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleContext } from "../i18n/locale-context";
import type { AssessmentBlockData } from "../types";
import { PreviewAssessmentBlock } from "./AssessmentBlock";

function data(downloadAs?: "txt" | "docx" | "both", inputType: "short" | "long" = "long") {
	return {
		assessmentType: "textResponse",
		stem: [{ id: "s1", type: "text", data: { content: "<p>Quelle est votre « idée » ?</p>" } }],
		response: { type: "textResponse", inputType, ...(downloadAs ? { downloadAs } : {}) },
		feedback: {},
		gradingMode: "none",
		private: true,
	} as AssessmentBlockData;
}

function renderResponse(
	options: {
		downloadAs?: "txt" | "docx" | "both";
		locale?: string;
		inputType?: "short" | "long";
	} = {},
) {
	return render(
		<MantineProvider>
			<LocaleContext.Provider value={options.locale ?? "en"}>
				<PreviewAssessmentBlock
					blockId="copy-reflection"
					data={data(options.downloadAs ?? "both", options.inputType)}
				/>
			</LocaleContext.Provider>
		</MantineProvider>,
	);
}

function installClipboard(writeText: (text: string) => Promise<void>) {
	const spy = vi.fn(writeText);
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: spy } });
	return spy;
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function status() {
	return document.querySelector<HTMLElement>("[data-copy-response-status]");
}

beforeEach(() => {
	Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
});

afterEach(() => {
	cleanup();
	Reflect.deleteProperty(navigator, "clipboard");
});

it("offers Copy only where response downloads are enabled", () => {
	const enabled = renderResponse({ downloadAs: "txt" });
	expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument();
	enabled.unmount();
	render(
		<MantineProvider>
			<PreviewAssessmentBlock blockId="no-download" data={data()} />
		</MantineProvider>,
	);
	expect(screen.queryByRole("button", { name: "Copy response" })).toBeNull();
});

it("copies the prompt and the exact multiline Unicode answer and reports success only after the clipboard resolves", async () => {
	const pending = deferred();
	const writeText = installClipboard(() => pending.promise);
	const submitted = vi.fn();
	const interacted = vi.fn();
	document.addEventListener("praxity:assessment-response", submitted);
	document.addEventListener("praxity:block-interaction", interacted);
	renderResponse();
	const answer = "Première ligne\n  Deuxième « ligne » 🌱\n\n日本語 & <fin>";
	fireEvent.change(screen.getByRole("textbox"), { target: { value: answer } });
	interacted.mockClear();
	const copy = screen.getByRole("button", { name: "Copy response" });
	copy.focus();
	fireEvent.click(copy);
	expect(writeText).toHaveBeenCalledWith(`Quelle est votre « idée » ?\n\n${answer}`);
	expect(status()).toHaveTextContent("");
	await act(async () => pending.resolve());
	expect(status()).toHaveTextContent("Copied the question and your answer.");
	expect(status()).toHaveAttribute("role", "status");
	expect(document.activeElement).toBe(copy);
	expect(screen.getByRole("textbox")).toHaveValue(answer);
	expect(submitted).not.toHaveBeenCalled();
	expect(interacted).not.toHaveBeenCalled();
	document.removeEventListener("praxity:assessment-response", submitted);
	document.removeEventListener("praxity:block-interaction", interacted);
});

it("gives a manual-copy message when the clipboard refuses", async () => {
	installClipboard(() => Promise.reject(new DOMException("Denied", "NotAllowedError")));
	renderResponse({ inputType: "short" });
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "My answer" } });
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy response" })));
	expect(status()).toHaveTextContent(
		"Copying didn't work. Select the text in the answer box and copy it.",
	);
});

it("gives the manual-copy message when the page has no clipboard access", async () => {
	renderResponse();
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "My answer" } });
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy response" })));
	expect(status()).toHaveTextContent(
		"Copying didn't work. Select the text in the answer box and copy it.",
	);
});

it.each([
	["en", "", "Write an answer before copying."],
	["fr", "  \n ", "Rédigez une réponse avant de copier."],
])("explains in %s that an empty answer has nothing to copy", async (locale, value, message) => {
	const writeText = installClipboard(() => Promise.resolve());
	renderResponse({ locale });
	fireEvent.change(screen.getByRole("textbox"), { target: { value } });
	const copy = screen.getByRole("button", {
		name: locale === "en" ? "Copy response" : "Copier la réponse",
	});
	expect(copy).toBeEnabled();
	await act(async () => fireEvent.click(copy));
	expect(writeText).not.toHaveBeenCalled();
	expect(status()).toHaveTextContent(message);
});

it("copies the edited answer after an earlier copy and clears the earlier success", async () => {
	const writeText = installClipboard(() => Promise.resolve());
	renderResponse({ locale: "fr" });
	const copy = screen.getByRole("button", { name: "Copier la réponse" });
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Premier jet" } });
	await act(async () => fireEvent.click(copy));
	expect(status()).toHaveTextContent("La question et votre réponse ont été copiées.");
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Version révisée" } });
	expect(status()).toHaveTextContent("");
	await act(async () => fireEvent.click(copy));
	expect(writeText).toHaveBeenLastCalledWith("Quelle est votre « idée » ?\n\nVersion révisée");
	expect(status()).toHaveTextContent("La question et votre réponse ont été copiées.");
});
