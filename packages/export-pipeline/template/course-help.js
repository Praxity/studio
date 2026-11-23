(() => {
	var script =
		document.currentScript || document.querySelector("script[data-praxity-course-help='true']");
	if (!script || document.querySelector("[data-praxity-help-root]")) return;
	var data = (name) => script.getAttribute(`data-help-${name}`) || "";
	var locale = data("locale") === "fr" ? "fr" : "en";
	var base = new URL(data("endpoint"), location.href);
	base.search = "";
	base.hash = "";
	if (!base.pathname.endsWith("/")) base.pathname += "/";
	var page = { id: data("page-id"), title: data("page-title") || document.title };

	var strings =
		locale === "fr"
			? {
					label: "Poser une question à l’équipe du cours",
					intro:
						"Posez une question sur cette page. Seuls vous et l’équipe du cours la voyez. Les réponses s’affichent ici la prochaine fois que vous ouvrez une page.",
					close: "Fermer",
					about: "À propos de :",
					removeQuote: "Retirer la citation",
					pointed: "la partie choisie de la page",
					question: "Votre question",
					send: "Envoyer la question",
					sending: "Envoi…",
					point: "Désigner une partie de la page",
					picking:
						"Cliquez sur une partie de la page, ou placez-y le focus et appuyez sur Entrée. Échap pour annuler.",
					cancel: "Annuler",
					empty: "Écrivez d’abord votre question.",
					sent: "Question envoyée. L’équipe du cours répondra ici.",
					sendError: "Envoi impossible. Vérifiez votre connexion et réessayez.",
					loadError:
						"Impossible de charger vos questions. Rechargez la page pour vous reconnecter.",
					tooMany:
						"Vous avez envoyé plusieurs messages dans la dernière minute. Attendez une minute, puis réessayez.",
					tooLong: "Ce message est trop long.",
					yours: "Vos questions",
					asked: (title, when) => `${title}, question posée le ${when}`,
					teamReplied: (when) => `Réponse de l’équipe du cours, ${when}`,
					youReplied: (when) => `Votre réponse, ${when}`,
					waiting: "En attente d’une réponse.",
					newTag: "Nouveau",
					reply: "Répondre",
					yourReply: "Votre réponse",
					sendReply: "Envoyer la réponse",
					emptyReply: "Écrivez d’abord votre réponse.",
					replySent: "Réponse envoyée.",
					newReplies: (n) => (n === 1 ? "1 nouvelle réponse" : `${n} nouvelles réponses`),
				}
			: {
					label: "Ask the course team",
					intro:
						"Ask a question about this page. Only you and the course team can see it. Replies appear here the next time you open a page.",
					close: "Close",
					about: "About:",
					removeQuote: "Remove quote",
					pointed: "the selected part of the page",
					question: "Your question",
					send: "Send question",
					sending: "Sending…",
					point: "Point at part of the page",
					picking: "Click part of the page, or move focus to it and press Enter. Escape cancels.",
					cancel: "Cancel",
					empty: "Write your question first.",
					sent: "Question sent. The course team will reply here.",
					sendError: "Couldn’t send. Check your connection and try again.",
					loadError: "Couldn’t load your questions. Reload the page to sign in again.",
					tooMany:
						"You’ve sent several messages in the last minute. Wait a minute, then try again.",
					tooLong: "This message is too long.",
					yours: "Your questions",
					asked: (title, when) => `${title}, asked ${when}`,
					teamReplied: (when) => `Course team replied ${when}`,
					youReplied: (when) => `You replied ${when}`,
					waiting: "Waiting for a reply.",
					newTag: "New",
					reply: "Reply",
					yourReply: "Your reply",
					sendReply: "Send reply",
					emptyReply: "Write your reply first.",
					replySent: "Reply sent.",
					newReplies: (n) => (n === 1 ? "1 new reply" : `${n} new replies`),
				};
	var label = data("label") || strings.label;
	var intro = data("intro") || strings.intro;
	var BODY_MAX = 2000;
	var QUOTE_MAX = 300;

	var stylesheet = document.createElement("link");
	stylesheet.rel = "stylesheet";
	stylesheet.href = new URL(`course-help.css${new URL(script.src).search}`, script.src).href;
	document.head.append(stylesheet);

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}
	function button(className, text) {
		var node = el("button", className, text);
		node.type = "button";
		return node;
	}
	function announce(region, text) {
		region.textContent = "";
		requestAnimationFrame(() => {
			region.textContent = text;
		});
	}
	var when = (iso) =>
		new Date(iso).toLocaleString(locale === "fr" ? "fr-CA" : "en-CA", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});

	var root = el("div", "praxity-help");
	root.setAttribute("data-praxity-help-root", "");
	var opener = button("praxity-help-button");
	opener.setAttribute("aria-haspopup", "dialog");
	var icon = el("span", "praxity-help-icon", "?");
	icon.setAttribute("aria-hidden", "true");
	var badge = el("span", "praxity-help-badge");
	badge.hidden = true;
	opener.append(icon, el("span", "praxity-help-label", label), badge);
	var news = el("p", "praxity-help-sr");
	news.setAttribute("role", "status");

	var picker = el("div", "praxity-help-picker");
	picker.hidden = true;
	var pickerCancel = button("praxity-help-secondary", strings.cancel);
	picker.append(el("p", "", strings.picking), pickerCancel);

	var dialog = el("dialog", "praxity-help-dialog");
	dialog.setAttribute("aria-labelledby", "praxity-help-title");
	dialog.setAttribute("aria-describedby", "praxity-help-intro");
	var head = el("div", "praxity-help-head");
	var title = el("h2", "", label);
	title.id = "praxity-help-title";
	var close = button("praxity-help-close", "×");
	close.setAttribute("aria-label", strings.close);
	head.append(title, close);
	var introText = el("p", "praxity-help-intro", intro);
	introText.id = "praxity-help-intro";

	var form = el("form", "praxity-help-form");
	var aboutBox = el("div", "praxity-help-about");
	aboutBox.hidden = true;
	var aboutQuote = el("q");
	var aboutText = el("p", "", `${strings.about} `);
	aboutText.append(aboutQuote);
	var removeQuote = button("praxity-help-secondary", strings.removeQuote);
	aboutBox.append(aboutText, removeQuote);
	var questionLabel = el("label", "", strings.question);
	var question = el("textarea");
	question.id = "praxity-help-question";
	question.rows = 4;
	question.maxLength = BODY_MAX;
	questionLabel.htmlFor = question.id;
	var actions = el("div", "praxity-help-actions");
	var send = el("button", "praxity-help-primary", strings.send);
	send.type = "submit";
	var point = button("praxity-help-secondary", strings.point);
	actions.append(send, point);
	var status = el("p", "praxity-help-status");
	status.setAttribute("role", "status");
	form.append(aboutBox, questionLabel, question, actions, status);

	var list = el("section", "praxity-help-list");
	list.hidden = true;
	list.setAttribute("aria-labelledby", "praxity-help-yours");
	var yours = el("h3", "", strings.yours);
	yours.id = "praxity-help-yours";
	yours.tabIndex = -1;
	var listStatus = el("p", "praxity-help-status");
	listStatus.setAttribute("role", "status");
	var threadList = el("ol");
	list.append(yours, listStatus, threadList);

	dialog.append(head, introText, form, list);
	root.append(opener, news, picker, dialog);

	var about = null;
	var unread = 0;
	var picking = false;
	var returnFocus = opener;

	class HelpError extends Error {
		constructor(status) {
			super(`HTTP ${status}`);
			this.status = status;
		}
	}
	async function call(path, body) {
		var response = await fetch(new URL(path, base), {
			method: body === undefined ? "GET" : "POST",
			credentials: "include",
			headers:
				body === undefined
					? { Accept: "application/json" }
					: { Accept: "application/json", "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) throw new HelpError(response.status);
		return response.json();
	}
	var failure = (error, fallback) =>
		error?.status === 429 ? strings.tooMany : error?.status === 413 ? strings.tooLong : fallback;

	function paintBadge(count) {
		unread = count;
		badge.hidden = !count;
		badge.replaceChildren();
		if (!count) return;
		var visible = el("span", "", String(count));
		visible.setAttribute("aria-hidden", "true");
		badge.append(visible, el("span", "praxity-help-sr", `, ${strings.newReplies(count)}`));
	}

	function render(result) {
		paintBadge(result.unread);
		list.hidden = !result.threads.length;
		threadList.replaceChildren(
			...result.threads.map((thread) => {
				var item = el("li", "praxity-help-thread");
				item.setAttribute("data-thread", String(thread.id));
				var asked = el("p", "praxity-help-body", thread.body);
				asked.id = `praxity-help-q-${thread.id}`;
				item.append(
					el(
						"p",
						"praxity-help-meta",
						strings.asked(thread.pageTitle || thread.pageId, when(thread.createdAt)),
					),
				);
				if (thread.quote)
					item.append(el("p", "praxity-help-quote", `${strings.about} “${thread.quote}”`));
				item.append(asked);
				for (var reply of thread.replies) {
					var box = el(
						"div",
						reply.fromStaff ? "praxity-help-reply" : "praxity-help-reply praxity-help-mine",
					);
					var meta = el(
						"p",
						"praxity-help-meta",
						(reply.fromStaff ? strings.teamReplied : strings.youReplied)(when(reply.createdAt)),
					);
					if (reply.fromStaff && !reply.read)
						meta.append(" ", el("span", "praxity-help-new", strings.newTag));
					box.append(meta, el("p", "praxity-help-body", reply.body));
					item.append(box);
				}
				if (!thread.replies.at(-1)?.fromStaff)
					item.append(el("p", "praxity-help-meta", strings.waiting));
				item.append(replyForm(thread.id));
				return item;
			}),
		);
	}

	function replyForm(id) {
		var wrap = el("div", "praxity-help-follow");
		var open = button("praxity-help-secondary", strings.reply);
		open.setAttribute("aria-describedby", `praxity-help-q-${id}`);
		var replyFormEl = el("form");
		replyFormEl.hidden = true;
		var fieldLabel = el("label", "", strings.yourReply);
		var field = el("textarea");
		field.id = `praxity-help-r-${id}`;
		field.rows = 3;
		field.maxLength = BODY_MAX;
		fieldLabel.htmlFor = field.id;
		var submit = el("button", "praxity-help-primary", strings.sendReply);
		submit.type = "submit";
		var cancel = button("praxity-help-secondary", strings.cancel);
		var row = el("div", "praxity-help-actions");
		row.append(submit, cancel);
		replyFormEl.append(fieldLabel, field, row);
		wrap.append(open, replyFormEl);
		open.addEventListener("click", () => {
			open.hidden = true;
			replyFormEl.hidden = false;
			listStatus.textContent = "";
			field.focus();
		});
		cancel.addEventListener("click", () => {
			replyFormEl.hidden = true;
			open.hidden = false;
			open.focus();
		});
		var busy = false;
		replyFormEl.addEventListener("submit", async (event) => {
			event.preventDefault();
			var body = field.value.trim();
			if (!body) {
				announce(listStatus, strings.emptyReply);
				field.focus();
				return;
			}
			if (busy) return;
			busy = true;
			submit.setAttribute("aria-disabled", "true");
			submit.textContent = strings.sending;
			try {
				render(await call(`threads/${id}/replies`, { body }));
				threadList.querySelector(`[data-thread="${id}"] .praxity-help-follow > button`)?.focus();
				announce(listStatus, strings.replySent);
			} catch (error) {
				announce(listStatus, failure(error, strings.sendError));
				busy = false;
				submit.removeAttribute("aria-disabled");
				submit.textContent = strings.sendReply;
			}
		});
		return wrap;
	}

	function setAbout(quote) {
		about =
			quote === null
				? null
				: quote.trim().replace(/\s+/g, " ").slice(0, QUOTE_MAX) || strings.pointed;
		aboutBox.hidden = !about;
		aboutQuote.textContent = about || "";
	}
	function takeSelection() {
		var selection = getSelection();
		var text = selection && !selection.isCollapsed ? selection.toString().trim() : "";
		if (text.length < 2) return;
		var node = selection.getRangeAt(0).commonAncestorContainer;
		var host = node.nodeType === 1 ? node : node.parentElement;
		if (host && !host.closest("[data-praxity-help-root], input, textarea")) setAbout(text);
	}

	var hadNews = false;
	async function openPanel(from) {
		returnFocus = from;
		status.textContent = "";
		takeSelection();
		hadNews = unread > 0;
		dialog.showModal();
		if (!hadNews) question.focus();
		try {
			var result = await call("threads");
			render(result);
			if (result.unread) {
				if (hadNews) yours.focus();
				paintBadge((await call("read", {})).unread);
			}
		} catch {
			announce(status, strings.loadError);
			if (hadNews) question.focus();
		}
	}

	opener.addEventListener("mousedown", (event) => event.preventDefault());
	opener.addEventListener("click", () => openPanel(opener));
	close.addEventListener("click", () => dialog.close());
	dialog.addEventListener("close", () => {
		if (!picking) returnFocus.focus();
	});
	removeQuote.addEventListener("click", () => {
		setAbout(null);
		question.focus();
	});

	var sending = false;
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		var body = question.value.trim();
		if (!body) {
			announce(status, strings.empty);
			question.focus();
			return;
		}
		if (sending) return;
		sending = true;
		send.setAttribute("aria-disabled", "true");
		send.textContent = strings.sending;
		question.readOnly = true;
		try {
			render(
				await call("threads", {
					pageId: page.id,
					pageTitle: page.title.trim().slice(0, 200),
					body,
					...(about ? { quote: about } : {}),
				}),
			);
			question.value = "";
			setAbout(null);
			announce(status, strings.sent);
		} catch (error) {
			announce(status, failure(error, strings.sendError));
		} finally {
			sending = false;
			send.removeAttribute("aria-disabled");
			send.textContent = strings.send;
			question.readOnly = false;
		}
	});

	var hovered = null;
	function hover(node) {
		hovered?.classList.remove("praxity-help-target");
		hovered = node;
		node?.classList.add("praxity-help-target");
	}
	function stopPicking(node) {
		picking = false;
		picker.hidden = true;
		opener.hidden = false;
		hover(null);
		document.documentElement.classList.remove("praxity-help-picking");
		if (node)
			setAbout(node.innerText || node.getAttribute("aria-label") || node.getAttribute("alt") || "");
		dialog.showModal();
		question.focus();
	}
	point.addEventListener("click", () => {
		picking = true;
		dialog.close();
		opener.hidden = true;
		picker.hidden = false;
		document.documentElement.classList.add("praxity-help-picking");
		pickerCancel.focus();
		announce(news, strings.picking);
	});
	pickerCancel.addEventListener("click", () => stopPicking(null));
	var outside = (target) => !target.closest("[data-praxity-help-root]");
	document.addEventListener(
		"mouseover",
		(event) => {
			if (picking && outside(event.target)) hover(event.target);
		},
		true,
	);
	document.addEventListener(
		"click",
		(event) => {
			if (!picking || !outside(event.target)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			stopPicking(event.target);
		},
		true,
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (!picking) return;
			if (event.key === "Escape") {
				event.preventDefault();
				stopPicking(null);
			} else if (
				(event.key === "Enter" || event.key === " ") &&
				outside(event.target) &&
				event.target !== document.body
			) {
				event.preventDefault();
				event.stopImmediatePropagation();
				stopPicking(event.target);
			}
		},
		true,
	);

	window.addEventListener("praxity:active-page-change", (event) => {
		var id = event.detail?.pageId;
		if (typeof id !== "string" || !id) return;
		var slide = document.querySelector(`[data-deck-slide="${CSS.escape(id)}"]`);
		page = {
			id,
			title: slide?.querySelector("h1, h2")?.textContent?.trim() || document.title,
		};
	});

	function mount() {
		document.body.append(root);
		call("threads").then(
			(result) => {
				paintBadge(result.unread);
				var latest = String(
					Math.max(
						0,
						...result.threads.flatMap((thread) =>
							thread.replies
								.filter((reply) => reply.fromStaff && !reply.read)
								.map((reply) => reply.id),
						),
					),
				);
				var told = null;
				try {
					told = sessionStorage.getItem("praxity.help.told");
					sessionStorage.setItem("praxity.help.told", latest);
				} catch {}
				if (result.unread && told !== latest) announce(news, strings.newReplies(result.unread));
			},
			() => {},
		);
	}
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", mount, { once: true });
	else mount();
})();
