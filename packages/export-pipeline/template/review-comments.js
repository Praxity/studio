(() => {
	var script =
		document.currentScript || document.querySelector("script[data-praxity-review-comments='true']");
	if (!script) return;

	var config = {
		pageId: script.getAttribute("data-review-page-id") || "",
		locale: script.getAttribute("data-review-locale") === "fr" ? "fr" : "en",
		expiresAt: script.getAttribute("data-review-expires-at") || "",
	};
	var localConfig = null;
	var configError = false;
	var bootstrap = document.querySelector('script[type="application/json"]#praxity-review-config');
	if (bootstrap) {
		try {
			localConfig = parseLocalConfig(JSON.parse(bootstrap.textContent));
			config.locale = localConfig.locale;
			config.pageId = localConfig.page.pageId;
		} catch {
			configError = true;
		}
	}
	var transport = localConfig ? createLocalTransport(localConfig) : createLegacyShareTransport();
	var strings =
		config.locale === "fr"
			? {
					comments: "Commentaires",
					collapse: "Réduire les commentaires",
					expand: "Développer les commentaires",
					loading: "Chargement des commentaires…",
					empty: "Aucun commentaire pour cette page.",
					name: "Nom",
					comment: "Commentaire",
					commentAction: "Commenter",
					commentingOn: "Commentaire sur\u202f:",
					addComment: "Ajouter un commentaire",
					post: "Publier le commentaire",
					posting: "Publication…",
					postSuccess: "Commentaire publié.",
					loadError: "Impossible de charger les commentaires.",
					postError: "Impossible de publier le commentaire.",
					reviewCopy: "Copie de révision — expire le",
				}
			: {
					comments: "Comments",
					collapse: "Collapse comments",
					expand: "Expand comments",
					loading: "Loading comments…",
					empty: "No comments on this page yet.",
					name: "Name",
					comment: "Comment",
					commentAction: "Comment",
					commentingOn: "Commenting on:",
					addComment: "Add a comment",
					post: "Post comment",
					posting: "Posting…",
					postSuccess: "Comment posted.",
					loadError: "Comments could not be loaded.",
					postError: "Comment could not be posted.",
					reviewCopy: "Review copy — expires",
				};
	Object.assign(
		strings,
		config.locale === "fr"
			? {
					open: "Ouvert",
					resolved: "Résolu",
					showOnPage: "Afficher sur la page",
					marker: "Commentaire",
					markerSeparator: "\u202f: ",
					textChanged: "Texte modifié",
					ambiguous: "Ambigu",
					deleted: "Cible supprimée",
					notVisible: "Non visible ici",
					moved: "Déplacé ou modifié\u202f?",
					pinMoved: "Repère déplacé vers le bloc",
					localReview: "Révision locale",
					unauthorized: "Accès à la révision expiré. Rouvrez la révision dans Studio.",
					forbidden: "Cette action n’est pas autorisée.",
					notFound: "Révision ou commentaire introuvable.",
					invalidInput: "Le commentaire ou sa cible n’est pas valide.",
					bodyTooLarge: "Le commentaire dépasse la taille autorisée.",
					draftOriginChanged:
						"Des brouillons antérieurs peuvent manquer. Les nouveaux brouillons peuvent ne pas survivre au redémarrage.",
					conflict: "La révision a changé. Rechargez les commentaires.",
					limitReached: "La limite de commentaires de cette révision est atteinte.",
					busy: "La révision est occupée. Réessayez.",
				}
			: {
					open: "Open",
					resolved: "Resolved",
					showOnPage: "Show on page",
					marker: "Comment",
					markerSeparator: ": ",
					textChanged: "Text changed",
					ambiguous: "Ambiguous",
					deleted: "Target deleted",
					notVisible: "Not visible here",
					moved: "Moved or changed?",
					pinMoved: "Pin moved to block",
					localReview: "Local review",
					unauthorized: "Review access expired. Reopen the review in Studio.",
					forbidden: "This action is not permitted.",
					notFound: "Review or comment not found.",
					invalidInput: "The comment or its target is invalid.",
					bodyTooLarge: "The comment exceeds the allowed size.",
					draftOriginChanged:
						"Earlier drafts may be unavailable. New drafts may not survive a restart.",
					conflict: "The review changed. Reload the comments.",
					limitReached: "This review has reached its comment limit.",
					busy: "The review is busy. Try again.",
				},
	);
	Object.assign(
		strings,
		config.locale === "fr"
			? {
					choose: "Commenter…",
					pin: "Repère",
					picker: "Choisir la cible du commentaire",
					wholePage: "Toute la page",
					next: "Suivant",
					cancel: "Annuler",
					save: "Enregistrer le commentaire",
					saved: "Commentaire enregistré.",
					retry: "Réessayer",
					pinHint: "Cliquez sur l’endroit à commenter. Appuyez sur Échap pour annuler.",
					pinRefused: "Choisissez un endroit dans un bloc identifié du cours.",
					selectionRefused:
						"Cette sélection ne peut pas être utilisée. Sélectionnez au plus {limit} caractères du cours.",
					tooLong: "Utilisez au plus {limit} caractères.",
					emptyBody: "Saisissez un commentaire.",
					draft: "Brouillon non envoyé",
					openDraft: "Ouvrir le brouillon",
					discardDraft: "Supprimer le brouillon",
					draftGone: "Ce brouillon a été envoyé ou supprimé dans un autre onglet.",
					alreadyPosted: "Déjà publié",
					draftPostedElsewhere:
						"Ce brouillon a été publié depuis un autre onglet. Votre texte a été conservé dans un nouveau brouillon.",
					draftChanged:
						"Un autre onglet a modifié ce brouillon. Rouvrez-le pour voir le texte actuel.",
					transitionBlocked:
						"Impossible de retirer le brouillon enregistré en toute sécurité. Gardez cette page ouverte, autorisez le stockage du navigateur, puis réessayez.",
					tabOnly:
						"La coordination entre onglets est indisponible. Les brouillons sont conservés uniquement dans cet onglet.",
					draftForked:
						"Un autre onglet a modifié ce brouillon. Votre texte a été conservé dans un brouillon distinct.",
					keepNew: "Conserver dans un nouveau brouillon",
					notConfirmed: "Non confirmé. Réessayer",
					discardChanged:
						"Un autre onglet a modifié ce brouillon. Rouvrez-le avant de le supprimer.",
					storageError:
						"Impossible d’enregistrer les brouillons dans ce navigateur. Gardez cette page ouverte jusqu’à l’enregistrement du commentaire.",
				}
			: {
					choose: "Comment on…",
					pin: "Pin",
					picker: "Choose what to comment on",
					wholePage: "Whole page",
					next: "Next",
					cancel: "Cancel",
					save: "Save comment",
					saved: "Comment saved.",
					retry: "Retry",
					pinHint: "Click the spot you want to comment on. Press Escape to cancel.",
					pinRefused: "Choose a spot inside identified course content.",
					selectionRefused:
						"This selection cannot be used. Select up to {limit} characters of course text.",
					tooLong: "Use at most {limit} characters.",
					emptyBody: "Enter a comment.",
					draft: "Unsent draft",
					openDraft: "Open draft",
					discardDraft: "Discard draft",
					draftGone: "This draft was sent or discarded in another tab.",
					alreadyPosted: "Already posted",
					draftPostedElsewhere:
						"This draft was posted from another tab. Your text was kept as a new draft.",
					draftChanged: "Another tab changed this draft. Reopen it to see the latest text.",
					transitionBlocked:
						"The saved draft could not be safely removed. Keep this page open, allow browser storage, then retry.",
					tabOnly: "Coordination between tabs is unavailable. Drafts are kept only in this tab.",
					draftForked: "Another tab changed this draft. Your text was kept as a separate draft.",
					keepNew: "Keep as new draft",
					notConfirmed: "Not confirmed. Retry",
					discardChanged: "Another tab changed this draft. Reopen it before discarding.",
					storageError:
						"Drafts cannot be saved in this browser. Keep this page open until your comment is saved.",
				},
	);

	Object.assign(
		strings,
		config.locale === "fr"
			? {
					blockKind: "Bloc",
					blockNoun: "le bloc",
					itemKind: "Élément",
					tabKind: "Onglet",
					sectionKind: "Section",
					selectedTarget: "Texte sélectionné\u202f: «\u202f{quote}\u202f»",
					targetLabel: "{kind}\u202f: {label}",
					draftSummary: "{draft}\u202f: {target}",
					draftBadge: "Brouillons\u202f: {count}",
					pinnedTarget: "Repère sur {label}",
					composerTitles: {
						quote: "Commentaire sur le texte sélectionné",
						pin: "Commentaire sur le repère",
						block: "Commentaire sur le bloc",
						page: "Commentaire sur toute la page",
					},
				}
			: {
					blockKind: "Block",
					blockNoun: "block",
					itemKind: "Item",
					tabKind: "Tab",
					sectionKind: "Section",
					selectedTarget: "Selected text: “{quote}”",
					targetLabel: "{kind}: {label}",
					draftSummary: "{draft}: {target}",
					draftBadge: "Drafts: {count}",
					pinnedTarget: "Pinned on {label}",
					composerTitles: {
						quote: "Comment on selected text",
						pin: "Comment on pin",
						block: "Comment on block",
						page: "Comment on whole page",
					},
				},
	);
	function formatted(template, values) {
		return template.replace(/\{(\w+)\}/g, (_match, key) => values[key]);
	}
	function parseLocalConfig(value) {
		function keys(object, expected) {
			return (
				object &&
				typeof object === "object" &&
				!Array.isArray(object) &&
				Object.keys(object).sort().join() === expected.split(" ").sort().join()
			);
		}
		if (
			!keys(
				value,
				"schema reviewId capability endpoint locale limits page textRules blockNames" +
					(Object.hasOwn(value || {}, "draftOriginChanged") ? " draftOriginChanged" : ""),
			) ||
			(value.draftOriginChanged !== undefined && value.draftOriginChanged !== true) ||
			value.schema !== 1 ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
				value.reviewId,
			) ||
			value.endpoint !== `/api/reviews/${value.reviewId}` ||
			typeof value.capability !== "string" ||
			!/^[A-Za-z0-9_-]{43,}$/.test(value.capability) ||
			!["en", "fr"].includes(value.locale) ||
			!keys(value.page, "lessonId pageId pageIds pageIndex revision") ||
			!keys(
				value.limits,
				"name body quoteExact quoteContext requestBodyBytes stateBytes authorReserveBytes id revision title pinPath pinDepth revealDepth cssPath listLimit cursor threadsPerReview messagesPerThread mutationsPerReview",
			) ||
			!Object.values(value.limits).every((n) => Number.isSafeInteger(n) && n > 0) ||
			value.limits.quoteContext !== 32
		)
			throw new Error("invalid_config");
		if (
			!keys(value.textRules, "controls surrogates") ||
			!Object.values(value.textRules).every((rule) => typeof rule === "string")
		)
			throw new Error("invalid_config");
		new RegExp(value.textRules.controls, "u");
		new RegExp(value.textRules.surrogates, "u");
		if (
			!value.blockNames ||
			typeof value.blockNames !== "object" ||
			Array.isArray(value.blockNames) ||
			!Object.values(value.blockNames).every((name) => typeof name === "string")
		)
			throw new Error("invalid_config");
		var page = value.page;
		if (
			![page.lessonId, page.pageId].every((v) => v === null || id(v, value.limits.id)) ||
			!(page.revision === null || id(page.revision, value.limits.revision)) ||
			!(
				page.pageIds === null ||
				(Array.isArray(page.pageIds) &&
					page.pageIds.length > 0 &&
					page.pageIds.every((v) => id(v, value.limits.id)) &&
					new Set(page.pageIds).size === page.pageIds.length)
			) ||
			!(
				page.pageIndex === null ||
				(Number.isSafeInteger(page.pageIndex) &&
					page.pageIndex >= 0 &&
					page.pageIds &&
					page.pageIds[page.pageIndex] === page.pageId)
			)
		)
			throw new Error("invalid_config");
		return value;
	}
	function id(value, limit) {
		return (
			typeof value === "string" &&
			value.length > 0 &&
			value.length <= limit &&
			value.trim() === value &&
			!/[\u0000-\u001f]/.test(value) &&
			!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
		);
	}

	function createLocalTransport(settings) {
		// Keep unknown outcomes until acknowledgement: the same payload reuses its receipt ID.
		async function request(url, options) {
			for (var attempt = 0; ; attempt++) {
				var response = await fetch(url, {
					...options,
					cache: "no-store",
					redirect: "error",
					headers: { "X-Praxity-Review": settings.capability, ...options?.headers },
				});
				var result = await response.json();
				if (response.status === 503 && result.code === "busy" && attempt === 0) {
					var retry = response.headers.get("Retry-After");
					var delay = /^\d+$/.test(retry) ? Number(retry) * 1000 : 1000;
					await new Promise((resolve) =>
						setTimeout(
							resolve,
							Math.min(30000, Math.max(0, Number.isFinite(delay) ? delay : 1000)),
						),
					);
					continue;
				}
				if (!response.ok || result.ok !== true) {
					var error = new Error(result.code || "request_failed");
					error.status = response.status;
					throw error;
				}
				return result;
			}
		}
		return {
			async list(pageId) {
				for (var restart = 0; restart < 3; restart++) {
					var threads = [],
						cursor = null,
						seen = new Set();
					try {
						for (var page = 0; page <= settings.limits.threadsPerReview; page++) {
							var query = new URLSearchParams({ page: pageId });
							if (cursor) query.set("cursor", cursor);
							var result = await request(`${settings.endpoint}/comments?${query}`);
							if (!Array.isArray(result.threads)) throw new Error("invalid_list");
							threads.push(...result.threads);
							if (threads.length > settings.limits.threadsPerReview)
								throw new Error("invalid_list");
							cursor = result.nextCursor;
							if (cursor === null) return threads;
							if (typeof cursor !== "string" || !cursor || seen.has(cursor))
								throw new Error("invalid_list");
							seen.add(cursor);
						}
						throw new Error("invalid_list");
					} catch (error) {
						if (error.message !== "snapshot_changed" || restart === 2) throw error;
					}
				}
			},
			async create(anchor, body, requestId) {
				return request(`${settings.endpoint}/comments`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reviewId: settings.reviewId, requestId, anchor, body }),
				});
			},
		};
	}

	function errorText(error, fallback) {
		var code = {
			unauthorized: "unauthorized",
			forbidden: "forbidden",
			not_found: "notFound",
			wrong_review: "notFound",
			invalid_input: "invalidInput",
			body_too_large: "bodyTooLarge",
			invalid_json: "invalidInput",
			invalid_body: "invalidInput",
			unsupported_media_type: "invalidInput",
			stale_version: "conflict",
			request_id_reused: "conflict",
			snapshot_changed: "conflict",
			invalid_cursor: "conflict",
			limit_reached: "limitReached",
			busy: "busy",
		}[error.message];
		return strings[code] || fallback;
	}

	function element(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function createLegacyShareTransport() {
		function shareBaseUrl() {
			var segments = location.pathname.split("/").filter(Boolean);
			var shareIndex = segments.indexOf("s");
			if (shareIndex === -1 || !segments[shareIndex + 1]) return location.origin;
			return `${location.origin}/s/${encodeURIComponent(segments[shareIndex + 1])}`;
		}

		return {
			list(pageId) {
				var query = new URLSearchParams({ page: pageId });
				return fetch(`${shareBaseUrl()}/comments?${query.toString()}`)
					.then((response) => {
						if (!response.ok) throw new Error("load_failed");
						return response.json();
					})
					.then((loaded) => (Array.isArray(loaded) ? loaded : []));
			},
			post(comment) {
				return fetch(`${shareBaseUrl()}/comments`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(comment),
				}).then((response) => {
					if (!response.ok) throw new Error("post_failed");
					return response.json();
				});
			},
		};
	}

	function expiryLabel() {
		var expiry = new Date(config.expiresAt);
		if (!config.expiresAt || Number.isNaN(expiry.getTime())) return strings.reviewCopy;
		return (
			strings.reviewCopy +
			" " +
			expiry.toLocaleDateString(config.locale === "fr" ? "fr-CA" : "en-CA", {
				year: "numeric",
				month: "short",
				day: "numeric",
			})
		);
	}

	function hidden(element) {
		for (var el = element; el; el = el.parentElement) {
			var style = getComputedStyle(el);
			var clipped =
				parseFloat(style.width) <= 1 &&
				parseFloat(style.height) <= 1 &&
				(/^rect\(\s*0(?:px)?(?:[\s,]+0(?:px)?){3}\s*\)$/i.test(style.clip) ||
					/^inset\(\s*50%\s*\)$/i.test(style.clipPath));
			if (
				clipped ||
				el.hidden ||
				el.hasAttribute("inert") ||
				el.getAttribute("aria-hidden") === "true" ||
				style.display === "none" ||
				style.visibility === "hidden" ||
				style.visibility === "collapse" ||
				(el.tagName === "DETAILS" &&
					!el.open &&
					element !== el.querySelector("summary") &&
					!el.querySelector("summary")?.contains(element))
			)
				return true;
		}
		return false;
	}

	function createAnchors(pageRoot, pageId) {
		var limits = localConfig.limits;
		// Runtime answer projections are private even when their native controls are hidden.
		var excluded = [
			"script,style,noscript,template,input,textarea,select,button,.praxity-button,option,output,canvas,[contenteditable],[data-disclosure-label],.praxity-disclosure-title",
			"[data-review-ui],.prx-review-sidebar,.prx-review-overlay,.prx-review-toggle,.praxity-sr-only,.praxity-a11y-sr-only,summary,[role='tab']",
			'[aria-live]:not([aria-live="off"]),[role~="status"],[role~="alert"],[role~="log"],[role~="timer"],.mantine-VisuallyHidden-root',
			"[data-rating-feedback],[data-self-check-comparison],[data-self-check-count],[data-self-check-status],[data-self-check-report],[data-self-check-part-state]",
			"[data-assessment-feedback],[data-assessment-correct-answers],[data-assessment-status],[data-option-feedback],.praxity-assessment-result,.praxity-choice-feedback",
			".praxity-fill-blank-response,.praxity-matching-answer,.praxity-order-item,.praxity-hotspot-caption,[data-mention],[data-signature-status],[data-retrieval-date-line]",
		].join(",");
		function asElement(node) {
			return node?.nodeType === 1 ? node : node?.parentElement;
		}
		function usable(el) {
			return el && pageRoot().contains(el) && !el.closest(excluded) && !hidden(el);
		}
		function stream(root) {
			var text = "",
				points = [];
			var previousBlock = null;
			function blockOwner(element) {
				for (var el = element; el && el !== root; el = el.parentElement) {
					if (/^(block|flow-root|flex|grid|list-item|table.*)$/.test(getComputedStyle(el).display))
						return el;
				}
				return root;
			}
			var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (var node = walker.nextNode(); node; node = walker.nextNode()) {
				if (!usable(node.parentElement)) continue;
				var block = blockOwner(node.parentElement);
				if (
					text &&
					previousBlock !== block &&
					!text.endsWith(" ") &&
					node.data &&
					!/^\s/u.test(node.data)
				) {
					var previous = points[points.length - 1];
					text += " ";
					points.push({ node: previous.endNode, start: previous.end, endNode: node, end: 0 });
				}
				previousBlock = block;
				for (var i = 0; i < node.data.length; i++) {
					var character = /\s/u.test(node.data[i]) ? " " : node.data[i];
					if (character === " " && text.endsWith(" ")) {
						points[points.length - 1].endNode = node;
						points[points.length - 1].end = i + 1;
					} else {
						text += character;
						points.push({ node, start: i, endNode: node, end: i + 1 });
					}
				}
			}
			return { text, points };
		}
		function bounded(text, max) {
			var end = Math.min(text.length, max);
			if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
			return text.slice(0, end);
		}
		function label(el) {
			return bounded(stream(el).text.trim(), limits.title) || null;
		}
		function pathFrom(root, target, max, depth) {
			var steps = [];
			for (var el = target; el && el !== root; el = el.parentElement) {
				if (!root.contains(el) || !el.parentElement || steps.length >= depth) return null;
				var same = Array.from(el.parentElement.children).filter(
					(child) => child.tagName === el.tagName,
				);
				steps.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${same.indexOf(el) + 1})`);
			}
			var path = steps.join(" > ");
			return path.length <= max ? path : null;
		}
		function verifiedPath(root, path, anchor) {
			if (
				anchor.revision !== localConfig.page.revision ||
				typeof path !== "string" ||
				!/^[a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\)(?:\s*>\s*[a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\))*$/.test(
					path,
				)
			)
				return null;
			var target = root.querySelector(`:scope > ${path}`);
			// The whole-course revision guards positional paths across re-exports.
			return target && targetLabel(target) === anchor.context.targetLabel ? target : null;
		}
		function base(target, node, block) {
			var root = pageRoot();
			var reveals = [];
			for (
				var ancestor = target;
				ancestor && root.contains(ancestor);
				ancestor = ancestor.parentElement
			) {
				if (
					ancestor.id &&
					(ancestor.matches("details[open]") ||
						Array.from(root.querySelectorAll("button[aria-expanded='true'][aria-controls]")).some(
							(control) => control.getAttribute("aria-controls").split(/\s+/).includes(ancestor.id),
						))
				)
					reveals.unshift(ancestor.id);
			}
			if (reveals.length > limits.revealDepth) return null;
			var anchor = {
				courseId: null,
				lessonId: localConfig.page.lessonId,
				pageId: pageId(),
				nodeId: node?.getAttribute("data-node-id") ?? null,
				blockId: node ? (block?.getAttribute("data-block-id") ?? null) : null,
				revision: localConfig.page.revision,
				quote: null,
				pin: null,
				tab: target?.closest("[role='tabpanel']")?.id || null,
				revealPath: reveals,
				cssPath:
					!node && target && target !== root
						? pathFrom(root, target, limits.cssPath, Infinity)
						: null,
				context: {
					pageTitle: label(root.querySelector("h1,h2,h3,h4,h5,h6") || root),
					targetLabel: target ? targetLabel(target) : null,
				},
			};
			if (
				[
					anchor.lessonId,
					anchor.pageId,
					anchor.nodeId,
					anchor.blockId,
					anchor.tab,
					...reveals,
				].some((value) => value !== null && !id(value, limits.id))
			)
				return null;
			return anchor;
		}
		var identitySelector =
			"button,.praxity-button,canvas,summary,[role='tab'],.praxity-order-item,[data-disclosure-label],.praxity-disclosure-title";
		function owningNode(target) {
			var node = target?.closest("[data-node-id]");
			var wrapper = node?.parentElement.closest("[data-block-type='button'][data-node-id]");
			return wrapper && wrapper.getAttribute("data-node-id") === node.getAttribute("data-node-id")
				? wrapper
				: node;
		}
		function identityLabel(target) {
			var label = target.matches(".praxity-order-item")
				? target.querySelector(".praxity-order-label")
				: target.matches("summary,[data-disclosure-label],.praxity-disclosure-title")
					? target
					: target.querySelector(".praxity-disclosure-title,[data-disclosure-label]");
			if (!label || hidden(label)) return "";
			var text = "",
				walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
			for (var node = walker.nextNode(); node; node = walker.nextNode()) {
				if (
					!node.parentElement.closest(
						"input,textarea,select,output,script,style,[aria-live],[aria-hidden='true'],.praxity-order-position,.praxity-order-controls",
					) &&
					!hidden(node.parentElement)
				)
					text += node.data;
			}
			return Array.from(text.replace(/\s+/gu, " ").trim()).slice(0, 60).join("");
		}
		function targetLabel(target) {
			var identity = target.closest(identitySelector);
			return identity ? identityLabel(identity) || null : label(target);
		}
		function fromBlock(target) {
			// Identity can name controls and graphics; their text stays outside the quote stream.
			var identityOnly = target?.closest(identitySelector);
			while (identityOnly?.parentElement.closest(identitySelector))
				identityOnly = identityOnly.parentElement.closest(identitySelector);
			if (
				!usable(target) &&
				!(
					identityOnly &&
					pageRoot().contains(target) &&
					!hidden(target) &&
					target.closest("[data-node-id]") &&
					!identityOnly.parentElement.closest(excluded) &&
					!target.closest(
						"[data-review-ui],input,textarea,select,[contenteditable],[aria-live],[role='status'],[role='alert']",
					)
				)
			)
				return null;
			return base(target, owningNode(target), target.closest("[data-block-id]"));
		}
		function fromSelection(range) {
			if (
				!range ||
				range.collapsed ||
				!usable(asElement(range.startContainer)) ||
				!usable(asElement(range.endContainer))
			)
				return null;
			var target = asElement(range.commonAncestorContainer);
			var startBlock = asElement(range.startContainer).closest("[data-block-id]");
			var endBlock = asElement(range.endContainer).closest("[data-block-id]");
			var node = startBlock === endBlock ? target.closest("[data-node-id]") : null;
			var flat = stream(node || pageRoot());
			var selected = flat.points
				.map((point, index) => ({ point, index }))
				.filter(
					({ point }) =>
						range.comparePoint(point.node, point.start) >= 0 &&
						range.comparePoint(point.endNode, point.end) <= 0,
				);
			if (!selected.length) return null;
			var start = selected[0].index,
				end = selected[selected.length - 1].index + 1;
			var exact = flat.text.slice(start, end);
			if (
				!exact.trim() ||
				exact.length > limits.quoteExact ||
				/[\uDC00-\uDFFF]/.test(exact[0]) ||
				/[\uD800-\uDBFF]/.test(exact[exact.length - 1])
			)
				return null;
			var prefixStart = Math.max(0, start - limits.quoteContext);
			if (/[\uDC00-\uDFFF]/.test(flat.text[prefixStart])) prefixStart++;
			var anchor = base(target, node, startBlock === endBlock ? startBlock : null);
			if (!anchor) return null;
			anchor.quote = {
				type: "TextQuoteSelector",
				exact,
				prefix: flat.text.slice(prefixStart, start),
				suffix: bounded(flat.text.slice(end), limits.quoteContext),
			};
			anchor.context.targetLabel = bounded(exact, limits.title);
			return anchor;
		}
		function fromPin(target, clientX, clientY) {
			var anchor = fromBlock(target),
				node = owningNode(target);
			if (!anchor || !node || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
			var path = pathFrom(node, target, limits.pinPath, limits.pinDepth);
			var box = target.getBoundingClientRect();
			if (path === null || !box.width || !box.height) return null;
			function fraction(value, start, size) {
				return Number(Math.min(1, Math.max(0, (value - start) / size)).toFixed(4));
			}
			anchor.pin = {
				path,
				x: fraction(clientX, box.left, box.width),
				y: fraction(clientY, box.top, box.height),
			};
			return anchor;
		}
		function matches(root, quote) {
			if (!quote?.exact) return [];
			var flat = stream(root),
				found = [];
			for (
				var i = flat.text.indexOf(quote.exact);
				i !== -1;
				i = flat.text.indexOf(quote.exact, i + 1)
			) {
				var score = 0;
				for (
					var p = 0;
					p < quote.prefix.length &&
					flat.text[i - 1 - p] === quote.prefix[quote.prefix.length - 1 - p];
					p++
				)
					score++;
				for (
					var s = 0;
					s < quote.suffix.length && flat.text[i + quote.exact.length + s] === quote.suffix[s];
					s++
				)
					score++;
				var first = flat.points[i],
					last = flat.points[i + quote.exact.length - 1];
				var range = document.createRange();
				range.setStart(first.node, first.start);
				range.setEnd(last.endNode, last.end);
				found.push({ target: asElement(range.commonAncestorContainer), range, score });
			}
			return found;
		}
		function best(found) {
			var score = Math.max(...found.map((match) => match.score));
			return found.filter((match) => match.score === score);
		}
		function resolve(anchor) {
			var root = pageRoot();
			function concealedWithin(scope) {
				return [scope, ...scope.querySelectorAll("[id]")].find(
					(el) => (el.id === anchor.tab || anchor.revealPath.includes(el.id)) && hidden(el),
				);
			}
			function missing() {
				var concealed = concealedWithin(root);
				return concealed ? { state: "notVisible", target: concealed } : { state: "deleted" };
			}
			var candidates = anchor.nodeId
				? Array.from(root.querySelectorAll("[data-node-id]")).filter(
						(el) => el.getAttribute("data-node-id") === anchor.nodeId,
					)
				: [];
			if (anchor.nodeId && root.getAttribute("data-node-id") === anchor.nodeId)
				candidates.unshift(root);
			if (candidates.length === 2) {
				var wrapper = candidates.find((el) =>
					el.matches("[data-block-type='button'][data-block-id]"),
				);
				var control = candidates.find((el) => el.matches("button.praxity-button"));
				var tab = candidates.find((el) => el.matches("[role='tab'][aria-controls]"));
				var panel = candidates.find((el) => el.matches("[role='tabpanel'][aria-labelledby]"));
				if (
					!anchor.quote &&
					wrapper &&
					control &&
					wrapper.contains(control) &&
					control.getAttribute("data-block-id") === wrapper.getAttribute("data-block-id")
				)
					candidates = [wrapper];
				else if (
					tab &&
					panel &&
					tab.getAttribute("aria-controls") === panel.id &&
					panel.getAttribute("aria-labelledby") === tab.id &&
					(anchor.tab === panel.id || !anchor.quote)
				)
					candidates = [anchor.tab === panel.id ? panel : tab];
			}
			var visible = candidates.filter((el) => !hidden(el));
			if (candidates.length && !visible.length)
				return { state: "notVisible", target: candidates[0] };
			var target = visible[0],
				match;
			if (visible.length > 1) {
				var ranked = best(
					visible.flatMap((el) =>
						best(matches(el, anchor.quote)).map((hit) => ({ ...hit, node: el })),
					),
				);
				if (ranked.length !== 1) return { state: "ambiguous" };
				target = ranked[0].node;
			}
			if (target) {
				var concealed = concealedWithin(target);
				if (concealed) return { state: "notVisible", target: concealed };
			}
			if (target && anchor.quote) {
				var found = best(matches(target, anchor.quote));
				if (!found.length) return { state: "textChanged", target };
				if (found.length > 1) return { state: "ambiguous", target };
				match = found[0];
			}
			if (!target) {
				var closed = concealedWithin(root);
				if (closed) return { state: "notVisible", target: closed };
			}
			if (!target && anchor.quote) {
				var elsewhere = matches(root, anchor.quote);
				var full = elsewhere.filter(
					(hit) => hit.score === anchor.quote.prefix.length + anchor.quote.suffix.length,
				);
				if (!anchor.nodeId && full.length === 1) return { ...full[0], state: "placed" };
				if (elsewhere.length > 1) return { state: "ambiguous" };
				if (elsewhere.length === 1)
					return {
						...elsewhere[0],
						state: "moved",
					};
				return missing();
			}
			if (!target && !anchor.nodeId && !anchor.quote && !anchor.pin && !anchor.cssPath)
				return { state: "page", target: root };
			if (
				!target &&
				anchor.revision === localConfig.page.revision &&
				anchor.cssPath &&
				!anchor.nodeId
			) {
				target = verifiedPath(root, anchor.cssPath, anchor);
			}
			if (!target) return missing();
			if (hidden(target)) return { state: "notVisible", target };
			if (anchor.pin) {
				var pinned = anchor.pin.path ? verifiedPath(target, anchor.pin.path, anchor) : target;
				if (!pinned) return { state: "pinMoved", target, pin: { x: 1, y: 0 } };
				return { state: hidden(pinned) ? "notVisible" : "placed", target: pinned, pin: anchor.pin };
			}
			return { state: "placed", target, range: match?.range };
		}
		return {
			fromSelection,
			fromPin,
			fromBlock,
			resolve,
			page: () => base(null, null, null),
			usableText: usable,
			identityLabel,
		};
	}

	function init() {
		if (document.querySelector(".prx-review-sidebar")) return;

		var comments = [];
		var loadVersion = 0;
		var loading = false;
		var posting = false;
		var activePageId = config.pageId;
		var pageHeading = "";
		var collapsed = true;
		function pageRoot() {
			return (
				Array.from(document.querySelectorAll("[data-deck-slide]")).find(
					(slide) => slide.getAttribute("data-deck-slide") === activePageId,
				) ||
				document.querySelector("main") ||
				document.body
			);
		}
		var anchors = localConfig ? createAnchors(pageRoot, () => activePageId) : null;
		// Read-only DOM capture/resolution interface for page-level regression tests.
		if (anchors) {
			var { fromSelection, fromPin, fromBlock, resolve, page } = anchors;
			window.PraxityReview = Object.freeze({ fromSelection, fromPin, fromBlock, resolve, page });
		}
		var deckUtilities =
			document.querySelector(".praxity-deck .deck-utility-items") ||
			document.querySelector(".praxity-deck .deck-utilities");
		var deckWorkspace = document.querySelector(".praxity-deck .deck-workspace");
		var isDeck = Boolean(deckUtilities && deckWorkspace);
		var sidebar = element("aside", "prx-review-sidebar");
		if (anchors) sidebar.classList.add("prx-review-sidebar--local");
		sidebar.id = "prx-review-sidebar";
		sidebar.setAttribute("role", "complementary");
		sidebar.setAttribute("aria-label", strings.comments);

		var header = element("header", "prx-review-header");
		var title = element("h2", "prx-review-title", strings.comments);
		var toggle = element("button", "prx-review-toggle");
		toggle.type = "button";
		toggle.setAttribute("aria-controls", sidebar.id);
		if (isDeck) {
			toggle.classList.add("prx-review-toggle--deck");
			header.append(title);
		} else {
			header.append(title, toggle);
		}
		var deckIcon;
		if (isDeck) {
			deckIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			deckIcon.setAttribute("class", "deck-utility-icon prx-review-icon");
			deckIcon.setAttribute("width", "20");
			deckIcon.setAttribute("height", "20");
			deckIcon.setAttribute("viewBox", "0 0 24 24");
			deckIcon.setAttribute("fill", "none");
			deckIcon.setAttribute("stroke", "currentColor");
			deckIcon.setAttribute("stroke-width", "1.75");
			deckIcon.setAttribute("stroke-linecap", "round");
			deckIcon.setAttribute("stroke-linejoin", "round");
			deckIcon.setAttribute("aria-hidden", "true");
			deckIcon.setAttribute("focusable", "false");
			var deckIconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
			deckIconPath.setAttribute(
				"d",
				"M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-4.5A7.5 7.5 0 0 1 4 11.5 7.5 7.5 0 0 1 11.5 4h1A7.5 7.5 0 0 1 20 11.5Z",
			);
			deckIcon.append(deckIconPath);
		}

		var content = element("div", "prx-review-content");
		var status = element("p", "prx-review-status", strings.loading);
		status.setAttribute("aria-live", "polite");
		var list = element("ol", "prx-review-list");
		list.setAttribute("role", "list");
		var error = element("p", "prx-review-error");
		error.setAttribute("role", "alert");
		error.hidden = true;

		var form = element("form", "prx-review-form");
		form.setAttribute("aria-label", strings.addComment);
		var nameLabel = element("label", "prx-review-label", strings.name);
		nameLabel.htmlFor = "prx-review-name";
		var nameInput = element("input", "prx-review-input");
		nameInput.id = "prx-review-name";
		nameInput.name = "name";
		nameInput.type = "text";
		nameInput.maxLength = 60;
		nameInput.required = true;
		nameInput.autocomplete = "name";
		var context = element("p", "prx-review-context");
		context.id = "prx-review-context";
		context.setAttribute("aria-live", "polite");
		var textLabel = element("label", "prx-review-label", strings.comment);
		textLabel.htmlFor = "prx-review-text";
		var textInput = element("textarea", "prx-review-input prx-review-textarea");
		textInput.id = "prx-review-text";
		textInput.name = "text";
		textInput.maxLength = 2000;
		textInput.required = true;
		textInput.rows = 4;
		textInput.setAttribute("aria-describedby", context.id);
		var submit = element("button", "prx-review-submit", strings.post);
		submit.type = "submit";
		form.append(nameLabel, nameInput, textLabel, textInput, submit, context);
		if (bootstrap) {
			nameLabel.hidden = nameInput.hidden = true;
			nameInput.required = false;
			textInput.maxLength = localConfig?.limits.body || 2000;
		}

		var footer = element("footer", "prx-review-footer", expiryLabel());
		if (bootstrap) footer.textContent = strings.localReview;
		content.append(status, list, error, form, footer);
		sidebar.append(header, content);
		if (isDeck) {
			deckWorkspace.classList.add("prx-review-workspace");
			deckWorkspace.append(sidebar);
		} else document.body.append(sidebar);
		if (isDeck) deckUtilities.append(toggle);
		var overlay = anchors ? element("div", "prx-review-overlay") : null;
		if (overlay) document.body.append(overlay);
		var entries = [];
		var frame = 0;
		var resolutionVersion = 0;
		var layoutObserver;
		var layoutRoot;
		var layoutInlineSize;
		var capMetrics = new Map();
		function textPinTop(target, x, y) {
			var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
			for (var node = walker.nextNode(); node; node = walker.nextNode()) {
				var range = document.createRange();
				range.selectNodeContents(node);
				var line = Array.from(range.getClientRects?.() || []).find(
					(rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
				);
				if (!line || !node.data.trim() || !anchors.usableText(node.parentElement)) continue;
				var font = getComputedStyle(node.parentElement).font;
				if (!capMetrics.has(font)) {
					var context = document.createElement("canvas").getContext("2d");
					if (context) context.font = font;
					var metrics = context?.measureText("H");
					capMetrics.set(
						font,
						metrics
							? Math.max(0, metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent) || 0
							: 0,
					);
				}
				// Keep the tail above glyphs, while preserving the stored point for graphics.
				return Math.min(y, line.top + capMetrics.get(font));
			}
			return y;
		}
		function resolveEntry(entry) {
			if (entry.resolutionVersion !== resolutionVersion) {
				entry.spot = anchors.resolve(entry.thread.anchor);
				entry.resolutionVersion = resolutionVersion;
			}
			return entry.spot;
		}
		function scheduleMarkers() {
			if (!overlay || frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				placeMarkers();
			});
		}
		function placeMarkers() {
			var ranges = [];
			var root = pageRoot();
			var viewportRight = document.documentElement.clientWidth - 1;
			var viewportBottom = document.documentElement.clientHeight - 1;
			if (layoutObserver && layoutRoot !== root) {
				layoutObserver.disconnect();
				layoutObserver.observe(root);
				layoutRoot = root;
				layoutInlineSize = undefined;
			}
			// Finish every DOM/style/geometry read before changing any marker or status.
			var placements = entries.map((entry) => {
				var spot = resolveEntry(entry);
				if (spot.state === "notVisible" || !spot.target || spot.state === "page")
					return { entry, spot, hidden: true };
				var box = spot.target.getBoundingClientRect();
				if (spot.range) {
					ranges.push(spot.range);
					var rects = Array.from(spot.range.getClientRects?.() || []);
					box = rects[rects.length - 1] || box;
				}
				var x = spot.pin ? box.left + spot.pin.x * box.width : box.right;
				var y = spot.pin ? box.top + spot.pin.y * box.height : box.top;
				if (spot.pin && spot.state !== "pinMoved") y = textPinTop(spot.target, x, y);
				var block = !spot.range && (!spot.pin || spot.state === "pinMoved");
				if (block) {
					var style = getComputedStyle(spot.target);
					var rtl = style.direction === "rtl";
					var gutter = rtl ? viewportRight - box.right : box.left;
					var lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 24;
					x =
						gutter >= 28
							? rtl
								? box.right + 16
								: box.left - 16
							: rtl
								? box.right - 4
								: box.left + 4;
					x = Math.max(12, Math.min(viewportRight - 12, x));
					y = gutter >= 28 ? box.top + lineHeight / 2 + 12 : box.top - 4;
				} else {
					// Circle above/right; its small tail ends at the captured point.
					x += 12;
					y -= 12;
				}
				var blocked = [
					[x, y - 12],
					[x - 24, y - 36],
					[x + 24, y - 36],
					[x - 24, y + 12],
					[x + 24, y + 12],
				]
					.map(([px, py]) => {
						// A gutter hit area can extend past the viewport; test its visible edge.
						px = Math.max(0, Math.min(viewportRight, px));
						py = Math.max(0, Math.min(viewportBottom, py));
						var hit = document.elementFromPoint(px, py);
						// Visible markers participate in hit testing; inspect below our layer without writes.
						if (hit?.closest(".prx-review-overlay"))
							hit = document
								.elementsFromPoint(px, py)
								.find((el) => !el.closest(".prx-review-overlay"));
						return (
							!hit ||
							!(root.contains(hit) || hit.contains(root)) ||
							Boolean(hit.closest("dialog[open],[aria-modal='true'],.praxity-dialog-sheet"))
						);
					})
					.some(Boolean);
				var hidden =
					blocked ||
					!box.width ||
					!box.height ||
					x < 12 ||
					x > viewportRight - 12 ||
					y < 24 ||
					y > viewportBottom;
				return { entry, spot, hidden, x, y, block };
			});
			// Selection UI shares this frame, after the marker geometry has been measured.
			if (reviewTools) reviewTools.updateSelection();
			var losingFocus = placements.find(
				({ entry, hidden }) => hidden && document.activeElement === entry.marker,
			);
			if (losingFocus) {
				collapsed = false;
				updateToggle();
				losingFocus.entry.item.focus({ preventScroll: true });
			}
			placements.forEach(({ entry, spot, hidden, x, y, block }) => {
				if (entry.state !== spot.state) {
					entry.chip.textContent = strings[spot.state] ? `⚠ ${strings[spot.state]}` : "";
					entry.chip.hidden = !entry.chip.textContent;
					entry.state = spot.state;
				}
				entry.marker.hidden = hidden;
				entry.marker.classList.toggle("prx-review-marker--block", Boolean(block));
				if (x !== undefined) entry.marker.style.left = `${x}px`;
				if (y !== undefined) entry.marker.style.top = `${y}px`;
			});
			if (typeof Highlight === "function" && window.CSS?.highlights) {
				if (ranges.length) CSS.highlights.set("prx-review-quote", new Highlight(...ranges));
				else CSS.highlights.delete("prx-review-quote");
			}
		}
		function showOnPage(entry) {
			var spot = resolveEntry(entry);
			var target = spot.target;
			if (!target) {
				status.textContent = strings[spot.state] || strings.notVisible;
				return;
			}
			// Only activate the learner's own disclosure/tab buttons, never arbitrary authored links.
			var ancestors = [];
			for (var el = target; el && pageRoot().contains(el); el = el.parentElement)
				ancestors.unshift(el);
			ancestors.forEach((el) => {
				if (el.matches("details:not([open])")) {
					var summary = el.querySelector(":scope > summary");
					if (summary && !hidden(summary)) summary.click();
				}
				if (
					el.id &&
					(el.hidden ||
						el.getAttribute("aria-hidden") === "true" ||
						getComputedStyle(el).display === "none")
				) {
					var controls = Array.from(pageRoot().querySelectorAll("button[aria-controls]")).filter(
						(control) =>
							control.getAttribute("aria-controls").split(/\s+/).includes(el.id) &&
							!control.disabled &&
							!hidden(control) &&
							control.getBoundingClientRect().width > 0 &&
							(control.getAttribute("role") === "tab" ||
								control.getAttribute("aria-expanded") === "false"),
					);
					if (controls.length === 1) controls[0].click();
				}
			});
			spot = anchors.resolve(entry.thread.anchor);
			if (spot.state === "notVisible" || !spot.target) {
				status.textContent = strings[spot.state] || strings.notVisible;
				scheduleMarkers();
				return;
			}
			target = spot.target;
			target.scrollIntoView?.({
				block: "center",
				behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
					? "auto"
					: "smooth",
			});
			if (!target.hasAttribute("tabindex")) {
				target.setAttribute("tabindex", "-1");
				target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
			}
			target.focus({ preventScroll: true });
			scheduleMarkers();
		}
		if (overlay) {
			if (typeof ResizeObserver === "function")
				layoutObserver = new ResizeObserver((entries = []) => {
					var entry = entries.find((entry) => entry.target === layoutRoot);
					if (entry) {
						var inlineSize = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
						if (layoutInlineSize !== undefined && inlineSize !== layoutInlineSize)
							resolutionVersion++;
						layoutInlineSize = inlineSize;
					}
					scheduleMarkers();
				});
			var viewportWidth = innerWidth;
			var mediaWatchers = new Map();
			function invalidateMarkers() {
				resolutionVersion++;
				scheduleMarkers();
			}
			function viewportResize() {
				if (innerWidth !== viewportWidth) {
					viewportWidth = innerWidth;
					invalidateMarkers();
				} else scheduleMarkers();
			}
			function watchMedia() {
				if (!window.matchMedia) return;
				var queries = new Set([
					"(prefers-color-scheme: dark)",
					"(forced-colors: active)",
					"(prefers-reduced-motion: reduce)",
				]);
				function collect(sheet) {
					if (sheet.media?.mediaText) queries.add(sheet.media.mediaText);
					var rules;
					try {
						rules = sheet.cssRules;
					} catch (failure) {
						// Browsers withhold cross-origin CSS rules; exported course sheets are same-origin.
						if (failure.name === "SecurityError") return;
						throw failure;
					}
					Array.from(rules || []).forEach((rule) => {
						if (rule.type === 4) queries.add(rule.conditionText);
						if (rule.styleSheet) collect(rule.styleSheet);
						else if (rule.cssRules) collect(rule);
					});
				}
				Array.from(document.styleSheets).forEach(collect);
				mediaWatchers.forEach((media, query) => {
					if (!queries.has(query)) {
						media.removeEventListener("change", invalidateMarkers);
						mediaWatchers.delete(query);
					}
				});
				queries.forEach((query) => {
					if (!mediaWatchers.has(query)) {
						var media = window.matchMedia(query);
						media.addEventListener("change", invalidateMarkers);
						mediaWatchers.set(query, media);
					}
				});
			}
			function stylesheetLoad(event) {
				if (event.target.matches?.("link[rel~='stylesheet']")) {
					watchMedia();
					invalidateMarkers();
				}
			}
			function stylesheetMutation(record) {
				var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
				return (
					target?.closest("style,link") ||
					[...record.addedNodes, ...record.removedNodes].some(
						(node) =>
							node.nodeType === 1 &&
							(node.matches("style,link[rel~='stylesheet']") ||
								node.querySelector("style,link[rel~='stylesheet']")),
					)
				);
			}
			window.addEventListener("scroll", scheduleMarkers, { capture: true, passive: true });
			window.addEventListener("resize", viewportResize);
			watchMedia();
			document.head.addEventListener("load", stylesheetLoad, true);
			var observer = new MutationObserver((records) => {
				var root = pageRoot();
				var stylesChanged = records.some(
					(record) => document.head.contains(record.target) && stylesheetMutation(record),
				);
				if (stylesChanged) watchMedia();
				if (
					stylesChanged ||
					records.some(
						(record) =>
							!document.head.contains(record.target) &&
							!asReviewUI(record.target) &&
							(root.contains(record.target) || record.target.contains(root)),
					)
				)
					invalidateMarkers();
			});
			var mutationOptions = {
				subtree: true,
				childList: true,
				characterData: true,
				attributes: true,
			};
			observer.observe(document.body, mutationOptions);
			observer.observe(document.head, mutationOptions);
			observer.observe(document.documentElement, { attributes: true });
			window.addEventListener(
				"pagehide",
				() => {
					observer.disconnect();
					layoutObserver?.disconnect();
					mediaWatchers.forEach((media) => media.removeEventListener("change", invalidateMarkers));
					document.head.removeEventListener("load", stylesheetLoad, true);
					cancelAnimationFrame(frame);
					frame = 0;
				},
				{ once: true },
			);
		}
		function asReviewUI(node) {
			return (node.nodeType === 1 ? node : node.parentElement)?.closest(
				"[data-review-ui],.prx-review-overlay,.prx-review-sidebar,.prx-review-toggle",
			);
		}

		function updateToggle() {
			var restoreFocus = document.activeElement === toggle;
			var more = isDeck && deckUtilities.closest("#deck-more");
			var moreButton = more ? more.querySelector("#deck-more-toggle") : null;
			var mobileMore = moreButton && getComputedStyle(moreButton).display !== "none";
			sidebar.classList.toggle("prx-review-sidebar--collapsed", collapsed);
			toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
			toggle.setAttribute("aria-label", collapsed ? strings.expand : strings.collapse);
			toggle.title = collapsed ? strings.expand : strings.collapse;
			toggle.textContent = "";
			if (isDeck) {
				if (collapsed) {
					if (mobileMore && restoreFocus && moreButton.getAttribute("aria-expanded") !== "true")
						moreButton.click();
					toggle.append(deckIcon);
					if (comments.length) {
						var deckBadge = element("span", "prx-review-count", String(comments.length));
						deckBadge.setAttribute("aria-label", String(comments.length));
						toggle.append(deckBadge);
					}
					deckUtilities.append(toggle);
					sidebar.hidden = true;
				} else {
					if (mobileMore && moreButton.getAttribute("aria-expanded") === "true") moreButton.click();
					toggle.textContent = "»";
					header.append(toggle);
					sidebar.hidden = false;
				}
				if (restoreFocus) toggle.focus();
			} else if (collapsed) {
				toggle.append(document.createTextNode(`${strings.comments} `));
				if (comments.length) {
					var badge = element("span", "prx-review-count", String(comments.length));
					badge.setAttribute("aria-label", String(comments.length));
					toggle.append(badge);
				}
			} else {
				toggle.textContent = "»";
			}
			if (reviewTools) reviewTools.placeActions();
			var draftCount = reviewTools?.draftCount() || 0;
			if (collapsed && draftCount) {
				var draftLabel = formatted(strings.draftBadge, { count: draftCount });
				toggle.append(element("span", "prx-review-draft-count", draftLabel));
				toggle.setAttribute("aria-label", `${strings.expand}, ${draftLabel}`);
			}
			if (collapsed && localConfig?.draftOriginChanged) {
				toggle.append(element("span", "prx-review-draft-origin", strings.draftOriginChanged));
				toggle.setAttribute(
					"aria-label",
					`${toggle.getAttribute("aria-label")}. ${strings.draftOriginChanged}`,
				);
			}
			scheduleMarkers();
		}

		function renderComments() {
			list.textContent = "";
			resolutionVersion++;
			entries = [];
			if (overlay) overlay.textContent = "";
			status.classList.toggle("praxity-a11y-sr-only", comments.length > 0);
			status.textContent = comments.length === 0 ? strings.empty : "";
			comments.forEach((comment, index) => {
				var item = element("li", "prx-review-comment");
				var message = anchors ? comment.messages[0] : null;
				var byline = element("p", "prx-review-comment-byline");
				var author = element(
					"strong",
					"",
					String(message?.actor.displayName || comment.name || ""),
				);
				var timestamp = element("time", "prx-review-comment-time");
				var date = new Date(message?.at || comment.at || "");
				timestamp.textContent = Number.isNaN(date.getTime())
					? ""
					: date.toLocaleString(config.locale === "fr" ? "fr-CA" : "en-CA");
				if (!Number.isNaN(date.getTime())) timestamp.dateTime = date.toISOString();
				byline.append(author, timestamp);
				var commentText = element(
					"p",
					"prx-review-comment-text",
					String(message?.body || comment.text || ""),
				);
				if (typeof comment.pageHeading === "string" && comment.pageHeading) {
					item.append(element("p", "prx-review-comment-heading", comment.pageHeading));
				}
				item.append(byline, commentText);
				if (anchors) {
					item.tabIndex = -1;
					var number = element("span", "prx-review-thread-number", String(index + 1));
					number.setAttribute("aria-hidden", "true");
					byline.prepend(number);
					item.append(
						element(
							"p",
							"prx-review-thread-status",
							comment.status === "resolved" ? strings.resolved : strings.open,
						),
					);
					if (comment.anchor.quote)
						item.append(element("blockquote", "prx-review-quote", comment.anchor.quote.exact));
					if (comment.status === "open") {
						var chip = element("p", "prx-review-anchor-status");
						var show = element("button", "prx-review-show", strings.showOnPage);
						show.type = "button";
						var marker = element("button", "prx-review-marker", String(index + 1));
						marker.type = "button";
						marker.hidden = true;
						var markerLabel = Array.from(comment.anchor.context.targetLabel || "")
							.slice(0, 60)
							.join("");
						marker.setAttribute(
							"aria-label",
							`${strings.marker} ${index + 1}${markerLabel ? strings.markerSeparator + markerLabel : ""}`,
						);
						marker.addEventListener("click", () => {
							collapsed = false;
							updateToggle();
							item.focus();
						});
						var entry = { thread: comment, chip, show, marker, item };
						show.addEventListener("click", () => showOnPage(entry));
						entries.push(entry);
						item.append(chip, show);
						overlay.append(marker);
					}
				}
				list.append(item);
			});
			updateToggle();
		}

		var reviewTools = anchors ? mountReviewTools() : null;
		function mountReviewTools() {
			function button(className, text, action) {
				var control = element("button", className, text);
				control.type = "button";
				control.setAttribute("data-review-ui", "");
				control.addEventListener("click", action);
				return control;
			}
			function announce(text) {
				composerStatus.textContent = "";
				queueMicrotask(() => {
					composerStatus.textContent = text;
				});
			}
			function dialog(className, heading) {
				var node = element("dialog", `prx-review-dialog ${className}`);
				node.setAttribute("data-review-ui", "");
				var title = element("h2", "", heading);
				title.id = `${className}-title`;
				node.setAttribute("aria-labelledby", title.id);
				node.append(title);
				document.body.append(node);
				return node;
			}
			function restoreFocus(opener) {
				if (opener === selectionButton) {
					[selectionButton, choose, pin, toggle, document.querySelector("#deck-more-toggle")]
						.find((control) => control?.isConnected && !hidden(control))
						?.focus({ preventScroll: true });
					return;
				}
				// A deck's mobile More panel may have closed since its action opened the dialog.
				var more = opener?.closest("#deck-more");
				var moreToggle = more?.querySelector("#deck-more-toggle");
				if (
					moreToggle &&
					getComputedStyle(moreToggle).display !== "none" &&
					moreToggle.getAttribute("aria-expanded") !== "true"
				)
					moreToggle.click();
				(opener?.isConnected && !hidden(opener) ? opener : choose).focus({ preventScroll: true });
			}
			var storageFailed = false;
			var current = null;
			var pendingViews = new Set();
			var sendingRequests = new Set();
			var reusedRequests = new Set(),
				refusalErrors = new Map();
			var composerOpener = null;
			var pickerOpener = null;
			var selectedRange = null;
			var pinning = false;
			var pinOpener = null;
			var threshold = 0;
			var choose = button("prx-review-choose prx-review-action", strings.choose, () =>
				openPicker(choose),
			);
			var pin = button("prx-review-pin prx-review-action", strings.pin, () =>
				pinning ? exitPin(true) : enterPin(pin),
			);
			pin.setAttribute("aria-pressed", "false");
			function placeActions() {
				var parent = isDeck && collapsed ? deckUtilities : header;
				var focused = [choose, pin].includes(document.activeElement)
					? document.activeElement
					: null;
				if (pin.parentElement !== parent || pin.nextSibling !== toggle)
					parent.insertBefore(pin, toggle);
				if (choose.parentElement !== parent || choose.nextSibling !== pin)
					parent.insertBefore(choose, pin);
				if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
			}
			placeActions();
			var picker = dialog("prx-review-picker", strings.picker);
			var choices = element("fieldset", "prx-review-targets");
			var pickerActions = element("div", "prx-review-actions");
			var next = button("prx-review-next", strings.next, () => {
				var checked = choices.querySelector("input:checked");
				var anchor = checked && targets[Number(checked.value)]?.anchor;
				if (!anchor) return;
				picker.close();
				openComposer(anchor, pickerOpener);
			});
			pickerActions.append(
				next,
				button("prx-review-picker-cancel prx-review-action", strings.cancel, () => closePicker()),
			);
			picker.append(choices, pickerActions);
			picker.addEventListener("cancel", (event) => {
				event.preventDefault();
				closePicker();
			});
			function closePicker() {
				picker.close();
				restoreFocus(pickerOpener);
			}
			var targets = [];
			function shortLabel(text) {
				var characters = Array.from(text);
				return characters.length > 60 ? `${characters.slice(0, 59).join("")}…` : text;
			}
			function blockLabel(block, anchor) {
				var type = block.getAttribute("data-block-type");
				var kind = Object.hasOwn(localConfig.blockNames, type)
					? localConfig.blockNames[type]
					: strings.blockKind;
				var heading = block.querySelector("h1,h2,h3,h4,h5,h6");
				var text =
					(heading && anchors.fromBlock(heading)?.context.targetLabel) ||
					anchor.context.targetLabel ||
					"";
				return text ? formatted(strings.targetLabel, { kind, label: shortLabel(text) }) : kind;
			}
			function selectionAnchor() {
				var selection = window.getSelection();
				if (selection?.rangeCount && !selection.isCollapsed)
					selectedRange = selection.getRangeAt(0).cloneRange();
				return selectedRange && anchors.fromSelection(selectedRange);
			}
			function openPicker(opener) {
				exitPin(false);
				selectionButton.hidden = true;
				pickerOpener = opener;
				targets = [];
				var selected = selectionAnchor();
				if (selected)
					targets.push({
						anchor: selected,
						label: formatted(strings.selectedTarget, { quote: shortLabel(selected.quote.exact) }),
					});
				targets.push({ anchor: anchors.page(), label: strings.wholePage });
				var defaultIndex = targets.length - 1;
				var foundVisible = false;
				Array.from(pageRoot().querySelectorAll("[data-block-id]")).forEach((block) => {
					if (block.parentElement.closest("[data-block-id]")) return;
					var anchor = anchors.fromBlock(block);
					if (!anchor) return;
					var box = block.getBoundingClientRect();
					if (
						!foundVisible &&
						box.bottom > 0 &&
						box.top < innerHeight &&
						box.right > 0 &&
						box.left < innerWidth
					) {
						defaultIndex = targets.length;
						foundVisible = true;
					}
					targets.push({ anchor, label: blockLabel(block, anchor) });
					Array.from(
						block.querySelectorAll(
							".praxity-order-item[data-node-id],[role='tab'][data-node-id],[data-accordion-item] [data-disclosure-label],summary",
						),
					).forEach((target) => {
						var nested = anchors.fromBlock(target),
							label = anchors.identityLabel(target);
						if (!nested || !label) return;
						var kind = target.matches(".praxity-order-item")
							? strings.itemKind
							: target.matches("[role='tab']")
								? strings.tabKind
								: strings.sectionKind;
						targets.push({
							anchor: nested,
							label: formatted(strings.targetLabel, { kind, label }),
						});
					});
				});
				choices.replaceChildren(element("legend", "prx-review-visually-hidden", strings.picker));
				targets.forEach((target, index) => {
					var label = element("label", "prx-review-target");
					var radio = element("input");
					radio.type = "radio";
					radio.name = "review-target";
					radio.value = String(index);
					radio.checked = index === defaultIndex;
					label.append(radio, document.createTextNode(target.label));
					choices.append(label);
				});
				picker.showModal();
				choices.querySelector("input:checked").focus();
			}

			var composer = dialog("prx-review-composer", "");
			var composerTitle = composer.querySelector("h2");
			var preview = element("div", "prx-review-target-preview");
			preview.id = "prx-review-target-preview";
			composer.setAttribute("aria-describedby", preview.id);
			var count = element("p", "prx-review-count-text");
			var composerStatus = element("p", "prx-review-composer-status prx-review-visually-hidden");
			composerStatus.setAttribute("role", "status");
			var storageError = element("p", "prx-review-storage-error prx-review-error");
			var tabWarning = element("p", "prx-review-tab-warning", strings.tabOnly);
			tabWarning.id = "prx-review-tab-warning";
			storageError.id = "prx-review-storage-error";
			storageError.hidden = true;
			var composerNotice = element("p", "prx-review-composer-notice");
			composerNotice.id = "prx-review-composer-notice";
			var originWarning = element("p", "prx-review-composer-origin", strings.draftOriginChanged);
			originWarning.id = "prx-review-composer-origin";
			var keepNew = button("prx-review-keep-new prx-review-action", strings.keepNew, async () => {
				var body = current.body;
				var forked = current.stale === "changed";
				var successor = draftSession(current.anchor);
				if (!forked) successor.draftId = current.draftId || current.record?.draftId;
				successor.body = body;
				current = successor;
				refreshComposer();
				if ((await keepDraft()) === "ok" && forked) resultNotice(successor, "forked");
				if (current === successor && composer.open) textInput.focus();
			});
			var cancel = button("prx-review-cancel prx-review-action", strings.cancel, () =>
				closeComposer(),
			);
			var composerActions = element("div", "prx-review-actions");
			composerActions.append(submit, keepNew, cancel);
			error.id = "prx-review-error";
			error.removeAttribute("role");
			textInput.removeAttribute("maxlength");
			textInput.setAttribute("aria-describedby", error.id);
			form.noValidate = true;
			form.replaceChildren(
				textLabel,
				textInput,
				count,
				error,
				composerNotice,
				storageError,
				tabWarning,
				originWarning,
				composerActions,
			);
			composer.append(preview, form, composerStatus);
			composer.addEventListener("cancel", (event) => {
				event.preventDefault();
				closeComposer();
			});
			composer.addEventListener("close", () => {
				touchClick = null;
				if (!composer.open && current) {
					keepDraft();
					current = null;
					refreshComposer();
				}
			});
			function describe(anchor) {
				return anchor.quote
					? anchor.quote.exact
					: anchor.pin
						? formatted(strings.pinnedTarget, {
								label: anchor.context.targetLabel || strings.blockNoun,
							})
						: anchor.nodeId || anchor.blockId || anchor.cssPath
							? anchor.context.targetLabel || strings.blockKind
							: strings.wholePage;
			}

			var draftPrefix = `praxity-review-draft:${localConfig.reviewId}:`;
			var outboxPrefix = `praxity-review-outbox:${localConfig.reviewId}:`;
			var storageAnnounced = false;
			function storageFailure() {
				storageFailed = true;
				if (current) refreshComposer();
			}
			function ordered(value) {
				if (Array.isArray(value)) return value.map(ordered);
				if (value && typeof value === "object")
					return Object.fromEntries(
						Object.keys(value)
							.sort()
							.map((key) => [key, ordered(value[key])]),
					);
				return value;
			}
			function equal(a, b) {
				return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
			}
			// One owner for browser records. Storage events never change an open session.
			var draftStore = (() => {
				var cache = new Map(),
					volatile = new Map(),
					quotaPredecessors = new Map(),
					memoryOnly = false,
					putBlocked = false,
					lastTime = 0,
					pending = 0;
				var manager = navigator.locks,
					shared = typeof manager?.request === "function";
				var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
				function storage() {
					return shared ? localStorage : sessionStorage;
				}
				function mutate(pageId, operation) {
					pending++;
					var task,
						acquired = false;
					var run = () => {
						acquired = true;
						return operation();
					};
					try {
						task =
							shared && !memoryOnly
								? manager.request(`praxity-review:${localConfig.reviewId}:${pageId}`, run)
								: Promise.resolve().then(run);
					} catch (error) {
						task = Promise.reject(error);
					}
					return Promise.resolve(task)
						.catch((error) => {
							if (acquired) throw error;
							if (!memoryOnly) {
								memoryOnly = true;
								cache.forEach((held, storageKey) => {
									var local = { raw: held.raw, durable: false };
									cache.set(storageKey, local);
									volatile.set(storageKey, local);
								});
								storageFailure();
							}
							return operation();
						})
						.finally(() => {
							pending--;
						});
				}
				function freeze(value) {
					Object.values(value).forEach((child) => {
						if (child && typeof child === "object") freeze(child);
					});
					return Object.freeze(value);
				}
				function key(kind, pageId, id) {
					return `${kind === "outbox" ? outboxPrefix : draftPrefix}${pageId}:${id}`;
				}
				function parse(storageKey, raw) {
					try {
						var value = JSON.parse(raw),
							kind = storageKey.startsWith(outboxPrefix) ? "outbox" : "draft",
							id = storageKey.slice(-36);
						if (
							!value ||
							!uuid.test(id) ||
							!value.anchor ||
							typeof value.body !== "string" ||
							typeof value.anchor.pageId !== "string" ||
							!value.anchor.context ||
							!(
								value.anchor.context.targetLabel === null ||
								typeof value.anchor.context.targetLabel === "string"
							) ||
							!(value.anchor.quote === null || typeof value.anchor.quote?.exact === "string") ||
							typeof value.savedAt !== "string" ||
							!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.savedAt) ||
							!Number.isFinite(Date.parse(value.savedAt)) ||
							storageKey !== key(kind, value.anchor.pageId, id) ||
							Object.keys(value).sort().join(" ") !==
								(kind === "outbox"
									? "anchor body draftId requestId savedAt"
									: "anchor body savedAt") ||
							(kind === "outbox" && (value.requestId !== id || !uuid.test(value.draftId)))
						)
							return null;
						lastTime = Math.max(lastTime, Date.parse(value.savedAt));
						return {
							kind,
							key: storageKey,
							id,
							raw,
							value: kind === "outbox" ? freeze(value) : value,
						};
					} catch {
						return null;
					}
				}
				function draftRaw(anchor, body) {
					lastTime = Math.max(Date.now(), lastTime + 1);
					return JSON.stringify({ body, anchor, savedAt: new Date(lastTime).toISOString() });
				}
				function read(storageKey) {
					if (memoryOnly)
						return { ...(cache.get(storageKey) || { raw: null, durable: false }), ok: true };
					try {
						var raw = storage().getItem(storageKey);
						if (raw !== null) {
							var found = { raw, durable: true };
							cache.set(storageKey, found);
							return { ...found, ok: true };
						}
						if (volatile.has(storageKey)) return { ...volatile.get(storageKey), ok: true };
						cache.delete(storageKey);
						return { raw: null, durable: false, ok: true };
					} catch {
						storageFailure();
						return { ...(cache.get(storageKey) || { raw: null, durable: false }), ok: false };
					}
				}
				function persist(storageKey, raw) {
					if (memoryOnly) return false;
					try {
						storage().setItem(storageKey, raw);
						cache.set(storageKey, { raw, durable: true });
						volatile.delete(storageKey);
						putBlocked = false;
						return true;
					} catch {
						putBlocked = true;
						storageFailure();
						return false;
					}
				}
				function put(storageKey, raw) {
					if (!putBlocked && persist(storageKey, raw)) return true;
					var held = { raw, durable: false };
					volatile.set(storageKey, held);
					cache.set(storageKey, held);
					return false;
				}
				function remove(storageKey, durable = true) {
					// Quota only blocks puts. Always attempt removal, including memory-only keys.
					try {
						if (!memoryOnly) storage().removeItem(storageKey);
					} catch {
						storageFailure();
						if (durable) return false;
					}
					cache.delete(storageKey);
					volatile.delete(storageKey);
					return true;
				}
				function list(pageId) {
					try {
						if (!memoryOnly) {
							var fresh = new Map(volatile),
								target = storage();
							for (var i = 0; i < target.length; i++) {
								var storageKey = target.key(i);
								if (storageKey?.startsWith(draftPrefix) || storageKey?.startsWith(outboxPrefix))
									fresh.set(storageKey, { raw: target.getItem(storageKey), durable: true });
							}
							cache = fresh;
						}
					} catch {
						storageFailure();
					}
					var rows = Array.from(cache, ([storageKey, held]) => parse(storageKey, held.raw)).filter(
						Boolean,
					);
					return rows
						.filter(
							(row) =>
								(pageId === undefined || row.value.anchor.pageId === pageId) &&
								(row.kind === "outbox" ||
									!rows.some(
										(other) =>
											other.kind === "outbox" &&
											other.value.draftId === row.id &&
											other.value.body === row.value.body &&
											equal(other.value.anchor, row.value.anchor),
									)),
						)
						.sort((a, b) => b.value.savedAt.localeCompare(a.value.savedAt));
				}
				function match(anchor) {
					var rows = list(anchor.pageId).filter((row) => equal(row.value.anchor, anchor));
					return rows.find((row) => row.kind === "outbox") || rows[0];
				}
				function writeDraftLocked(session, body, dirty = body !== session.recordedBody) {
					if (session.gone) return session.stale || "gone";

					if (!session.draftId && !dirty) return "ok";
					session.draftId ||= crypto.randomUUID();
					var storageKey = key("draft", session.anchor.pageId, session.draftId),
						actual = read(storageKey),
						result = "ok";
					// A conflict fork must sort after the value just observed, even in the same millisecond.
					if (actual.raw) parse(storageKey, actual.raw);
					if (!actual.ok && actual.durable && !dirty) return "blocked";
					if (actual.raw !== null && actual.raw !== session.lastSeen && actual.ok) {
						var admitted = parse(storageKey, actual.raw);
						if (
							admitted &&
							admitted.value.body === body &&
							equal(admitted.value.anchor, session.anchor)
						) {
							session.lastSeen = actual.raw;
							session.recordedBody = body;
							return "ok";
						}
					}
					if (
						(actual.raw === null && session.lastSeen !== null) ||
						actual.raw !== session.lastSeen ||
						(!actual.ok && actual.durable)
					) {
						if (!dirty) {
							session.gone = true;
							session.stale = actual.raw === null ? "gone" : "changed";
							return session.stale;
						}
						if (
							actual.raw !== null ||
							!actual.ok ||
							read(key("outbox", session.anchor.pageId, session.draftId)).raw !== null
						) {
							session.draftId = crypto.randomUUID();
							storageKey = key("draft", session.anchor.pageId, session.draftId);
							result = "forked";
						}
					} else if (
						!dirty &&
						((actual.raw === null && body === "" && !quotaPredecessors.has(session.draftId)) ||
							(actual.raw && JSON.parse(actual.raw).body === body))
					)
						return "ok";
					if (!body) {
						if (!retireQuota(session.draftId)) return "blocked";
						if (!remove(storageKey, actual.durable)) return "blocked";
						session.lastSeen = null;
						session.recordedBody = body;
						return "ok";
					}
					var raw = draftRaw(session.anchor, body);
					var durable = put(storageKey, raw);
					if (
						!durable &&
						actual.durable &&
						storageKey === key("draft", session.anchor.pageId, session.draftId) &&
						result !== "forked"
					) {
						// Keep the durable version until its edited successor can safely retire it.
						volatile.delete(storageKey);
						cache.set(storageKey, actual);
						session.draftId = crypto.randomUUID();
						quotaPredecessors.set(session.draftId, { key: storageKey, raw: actual.raw });
						storageKey = key("draft", session.anchor.pageId, session.draftId);
						put(storageKey, raw);
						result = "storage";
					}
					session.lastSeen = raw;
					session.recordedBody = body;
					return result;
				}
				function write(session, body) {
					// A reload within milliseconds of an edit, or while another tab holds the draft lock,
					// can lose that edit. Text already saved survives. The review page's CSP sandbox
					// suppresses the leave prompt. A follow-up journal will back up queued edits.
					var dirty = body !== session.recordedBody;
					if (!shared && !memoryOnly)
						return Promise.resolve(writeDraftLocked(session, body, dirty));
					var version = (session.writeVersion = (session.writeVersion || 0) + 1);
					return mutate(session.anchor.pageId, () => {
						if (version !== session.writeVersion) return "obsolete";
						return writeDraftLocked(session, body, dirty);
					});
				}
				function retireQuota(draftId) {
					var predecessor = quotaPredecessors.get(draftId);
					if (!predecessor) return true;
					var actual = read(predecessor.key);
					if (!actual.ok && actual.durable) return false;
					if (actual.raw === predecessor.raw && !remove(predecessor.key, actual.durable))
						return false;
					quotaPredecessors.delete(draftId);
					return true;
				}
				function discard(row) {
					return mutate(row.value.anchor.pageId, () => {
						var actual = read(row.key);
						if ((!actual.ok && actual.durable) || actual.raw !== row.raw) return false;
						if (!retireQuota(row.id)) return false;
						if (!remove(row.key, actual.durable)) return false;
						return true;
					});
				}
				function retirePredecessor(record) {
					var storageKey = key("draft", record.anchor.pageId, record.draftId),
						actual = read(storageKey);
					if (!actual.ok && actual.durable) return false;
					var row = actual.raw && parse(storageKey, actual.raw);
					if (row && (row.value.body !== record.body || !equal(row.value.anchor, record.anchor)))
						return true;
					if (actual.raw !== null && !row) return false;
					return remove(storageKey, actual.durable);
				}
				function send(session) {
					return mutate(session.anchor.pageId, () => {
						session.draftId ||= crypto.randomUUID();
						var outboxKey = key(
								"outbox",
								session.anchor.pageId,
								session.kind === "outbox" ? session.record.requestId : session.draftId,
							),
							actual = read(outboxKey);
						if (!actual.ok && actual.durable) return { status: "blocked" };
						if (session.kind === "outbox" && actual.raw === null) return { status: "gone" };
						var existing = parse(outboxKey, actual.raw),
							record = session.kind === "outbox" ? session.record : existing?.value;
						if (
							record &&
							session.kind === "draft" &&
							(record.body !== session.body || !equal(record.anchor, session.anchor))
						) {
							session.draftId = crypto.randomUUID();
							session.lastSeen = null;
							session.recordedBody = "";
							session.notice = strings.draftForked;
							record = null;
						}
						if (!record) {
							var result = writeDraftLocked(session, session.body);
							if (!["ok", "storage", "forked"].includes(result)) return { status: result };
							if (result === "forked") session.notice = strings.draftForked;
							record = freeze(
								JSON.parse(
									JSON.stringify({
										body: session.body,
										anchor: session.anchor,
										requestId: session.draftId,
										draftId: session.draftId,
										savedAt: new Date().toISOString(),
									}),
								),
							);
							put(key("outbox", record.anchor.pageId, record.draftId), JSON.stringify(record));
						}
						if (refusalErrors.has(record.requestId))
							return refuseLocked(record, reusedRequests.has(record.requestId));
						if (!retireQuota(record.draftId) || !retirePredecessor(record))
							return { status: "blocked", record };
						return { status: "outbox", record };
					});
				}
				function ack(record) {
					return mutate(record.anchor.pageId, () =>
						remove(
							key("outbox", record.anchor.pageId, record.requestId),
							cache.get(key("outbox", record.anchor.pageId, record.requestId))?.durable !== false,
						),
					);
				}
				function refusalSuccessor(record, draftId) {
					var storageKey = key("draft", record.anchor.pageId, draftId),
						actual = read(storageKey);
					var row = actual.raw && parse(storageKey, actual.raw);
					return row && row.value.body === record.body && equal(row.value.anchor, record.anchor)
						? row
						: null;
				}
				async function reusedDraftId(record, candidate = record.requestId) {
					var bytes = new Uint8Array(
						await crypto.subtle.digest(
							"SHA-256",
							new TextEncoder().encode(
								JSON.stringify(ordered([candidate, record.body, record.anchor])),
							),
						),
					);
					bytes[6] = (bytes[6] & 15) | 128;
					bytes[8] = (bytes[8] & 63) | 128;
					var hex = Array.from(bytes.slice(0, 16), (byte) =>
						byte.toString(16).padStart(2, "0"),
					).join("");
					return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
				}
				async function reusedSuccessor(record) {
					var candidate = record.requestId;
					// Keep colliding refusals convergent, without unbounded hashing of occupied slots.
					for (var step = 0; step < 8; step++) {
						candidate = await reusedDraftId(record, candidate);
						var draftKey = key("draft", record.anchor.pageId, candidate),
							outboxKey = key("outbox", record.anchor.pageId, candidate),
							draft = read(draftKey),
							outbox = read(outboxKey);
						if ((!draft.ok && draft.durable) || (!outbox.ok && outbox.durable))
							return { blocked: true };
						var submitted = outbox.raw && parse(outboxKey, outbox.raw);
						if (
							submitted?.value.body === record.body &&
							equal(submitted.value.anchor, record.anchor)
						)
							return { draftId: candidate, outbox: submitted };
						var row = refusalSuccessor(record, candidate);
						if (outbox.raw === null && (draft.raw === null || row))
							return { draftId: candidate, row };
					}
					return { draftId: crypto.randomUUID(), forked: true };
				}
				async function refuseLocked(record, reused) {
					var storageKey = key("outbox", record.anchor.pageId, record.requestId),
						actual = read(storageKey);
					if (actual.raw === null) return { status: "gone" };
					if (!actual.ok && actual.durable) return { status: "blocked", record };
					var resolved = reused
						? await reusedSuccessor(record)
						: { draftId: record.draftId, row: refusalSuccessor(record, record.draftId) };
					if (resolved.blocked) return { status: "blocked", record };
					var session = resolved.outbox
						? outboxSession(resolved.outbox.value, record.anchor)
						: draftSession(record.anchor, resolved.row);
					session.draftId = resolved.draftId;
					session.body = record.body;
					var result = resolved.outbox ? "ok" : writeDraftLocked(session, record.body);
					if (!["ok", "storage", "forked"].includes(result)) return { status: result, record };
					var draftKey = key(
							resolved.outbox ? "outbox" : "draft",
							record.anchor.pageId,
							session.draftId,
						),
						successor = cache.get(draftKey);
					function blocked() {
						if (successor?.durable === false) {
							cache.delete(draftKey);
							volatile.delete(draftKey);
						}
						return { status: "blocked", record };
					}
					if (!successor) return blocked();
					if (actual.durable && successor?.durable !== true) {
						// Refusal is not permission to trade saved text for volatile text. A failed
						// same-value write also fences persistent storage denial before removing anything.
						if (!persist(storageKey, actual.raw) || !remove(storageKey, true)) return blocked();
						if (!persist(draftKey, successor.raw)) {
							if (!persist(storageKey, actual.raw)) put(storageKey, actual.raw);
							return blocked();
						}
					} else if (!remove(storageKey, actual.durable)) return { status: "blocked", record };
					if (resolved.forked || result === "forked") session.notice = strings.draftForked;
					else if (reused) session.notice = strings.draftPostedElsewhere;
					if (!reused && session.notice)
						session.error = refusalErrors.get(record.requestId) || strings.postError;
					return { status: "editable", session };
				}
				function refuse(record, reused) {
					return mutate(record.anchor.pageId, () => refuseLocked(record, reused));
				}

				return {
					list,
					match,
					write,
					discard,
					send,
					ack,
					refuse,
					get tabOnly() {
						return !shared && !memoryOnly;
					},
					hasPending: () =>
						pending > 0 ||
						list().some(
							(row) =>
								row.kind === "outbox" || (volatile.has(row.key) && row.value.body.length > 0),
						),
				};
			})();
			function draftSession(anchor, row) {
				return {
					kind: "draft",
					anchor,
					body: row?.value.body || "",
					draftId: row?.id || null,
					lastSeen: row?.raw || null,
					recordedBody: row?.value.body || "",
					gone: false,
					notice: "",
					error: "",
				};
			}
			function outboxSession(record, anchor = record.anchor) {
				return {
					kind: "outbox",
					record,
					anchor,
					body: record.body,
					notice: "",
					error: refusalErrors.get(record.requestId) || "",
				};
			}
			var draftList = element("div", "prx-review-drafts"),
				draftRows = new Map();
			content.insertBefore(draftList, footer);
			function renderDrafts() {
				var rows = draftStore.list(activePageId),
					focused = document.activeElement;
				var keys = new Set(rows.map((row) => row.key));
				draftRows.forEach((view, storageKey) => {
					if (!keys.has(storageKey)) {
						view.node.remove();
						draftRows.delete(storageKey);
					}
				});
				rows.forEach((row, index) => {
					var view = draftRows.get(row.key);
					if (!view) {
						view = {
							node: element("div", "prx-review-draft"),
							summary: element("p"),
							body: element("p", "prx-review-draft-body"),
						};
						view.open = button(
							row.kind === "outbox"
								? "prx-review-retry-outbox prx-review-action"
								: "prx-review-open-draft prx-review-action",
							row.kind === "outbox" ? strings.retry : strings.openDraft,
							() => openComposer(view.row.value.anchor, view.open, view.row),
						);
						view.node.append(view.summary, view.body, view.open);
						if (row.kind === "draft")
							view.node.append(
								button(
									"prx-review-discard-draft prx-review-action",
									strings.discardDraft,
									async () => {
										try {
											if (!(await draftStore.discard(view.row)))
												status.textContent = strings.discardChanged;
										} catch {
											status.textContent = strings.transitionBlocked;
										}
										renderDrafts();
									},
								),
							);
						draftRows.set(row.key, view);
					}
					view.row = row;
					view.summary.id = `prx-review-draft-${row.id}`;
					view.node
						.querySelectorAll("button")
						.forEach((control) => control.setAttribute("aria-describedby", view.summary.id));
					view.summary.textContent = formatted(strings.draftSummary, {
						draft: row.kind === "outbox" ? strings.notConfirmed : strings.draft,
						target: describe(row.value.anchor),
					});
					view.body.textContent = row.value.body;
					if (draftList.children[index] !== view.node)
						draftList.insertBefore(view.node, draftList.children[index] || null);
				});
				if (
					focused?.closest(".prx-review-drafts") ||
					(!focused?.isConnected &&
						focused?.matches(
							".prx-review-open-draft,.prx-review-discard-draft,.prx-review-retry-outbox",
						))
				) {
					(focused.isConnected ? focused : choose).focus({ preventScroll: true });
				}
				updateToggle();
			}
			window.addEventListener("storage", (event) => {
				if (
					event.key === null ||
					event.key.startsWith(draftPrefix) ||
					event.key.startsWith(outboxPrefix)
				)
					renderDrafts();
			});
			function resultNotice(view, result) {
				if (result === "storage") view.notice = "";
				var notice =
					result === "gone"
						? strings.draftGone
						: result === "changed"
							? strings.draftChanged
							: result === "forked"
								? strings.draftForked
								: result === "blocked"
									? strings.transitionBlocked
									: "";
				if (notice) {
					view.notice = notice;
					if (current === view && composer.open) announce(notice);
					else {
						status.textContent = "";
						queueMicrotask(() => {
							status.textContent = notice;
						});
					}
				}
				if (current === view) {
					refreshComposer();
					if (
						view.gone &&
						composer.open &&
						(document.activeElement === textInput || document.activeElement === submit)
					)
						keepNew.focus({ preventScroll: true });
				}
				renderDrafts();
			}
			async function keepDraft() {
				if (current?.kind !== "draft" || isSending(current) || current.gone) return "ok";
				var view = current;
				view.body = textInput.value;
				var pending = { view };
				pendingViews.add(pending);
				try {
					var result = await draftStore.write(view, view.body);
					resultNotice(view, result);
					return result;
				} catch {
					resultNotice(view, "blocked");
					return "blocked";
				} finally {
					pendingViews.delete(pending);
				}
			}
			function openComposer(anchor, opener, retained) {
				exitPin(false);
				touchClick = null;
				selectionButton.hidden = true;
				composerOpener = opener;
				var row = retained || draftStore.match(anchor);
				var pending = Array.from(pendingViews)
					.reverse()
					.find(
						({ view }) =>
							equal(view.anchor, anchor) &&
							(!retained ||
								(retained.kind === "outbox"
									? view.record?.requestId === retained.id
									: view.draftId === retained.id)),
					);
				current =
					pending?.view ||
					(row?.kind === "outbox" ? outboxSession(row.value, anchor) : draftSession(anchor, row));
				composerStatus.textContent = "";
				threshold = 0;
				refreshComposer();
				composer.showModal();
				refreshComposer();
				textInput.focus();
				if (current.notice) announce(current.notice);
			}
			function closeComposer(returnFocus = true) {
				touchClick = null;
				if (!composer.open) return;
				keepDraft();
				current = null;
				composer.close();
				refreshComposer();
				updateSelection();
				if (returnFocus) restoreFocus(composerOpener);
			}
			function updateCount(speak = true) {
				var size = textInput.value.length,
					limit = localConfig.limits.body;
				count.textContent = `${size} / ${limit}`;
				var nextThreshold = size >= limit ? 2 : size >= Math.ceil(limit * 0.9) ? 1 : 0;
				if (speak && nextThreshold > threshold) announce(count.textContent);
				threshold = nextThreshold;
			}
			textInput.addEventListener("input", () => {
				if (current?.kind !== "draft" || isSending(current)) return;
				current.error = "";
				updateCount();
				keepDraft();
			});
			function fieldError(message) {
				current.error = message;
				refreshComposer();
				announce(message);
			}
			function isSending(view) {
				return (
					Boolean(view?.transferring) ||
					(view?.kind === "outbox" && sendingRequests.has(view.record.requestId))
				);
			}
			function refreshComposer() {
				var sending = isSending(current);
				if (textInput.value !== (current?.body || "")) textInput.value = current?.body || "";
				textInput.readOnly = current?.kind === "outbox" || Boolean(current?.gone) || sending;
				var saveFocused = document.activeElement === submit;
				submit.disabled =
					loading || !current || Boolean(isSending(current)) || Boolean(current.gone);
				cancel.disabled = false;
				submit.textContent = sending
					? strings.posting
					: current?.kind === "outbox"
						? strings.retry
						: strings.save;
				error.textContent = current?.error || "";
				error.hidden = !error.textContent;
				if (error.textContent) textInput.setAttribute("aria-invalid", "true");
				else textInput.removeAttribute("aria-invalid");
				composerNotice.textContent = current?.notice || "";
				composerNotice.hidden = !composerNotice.textContent;
				keepNew.hidden = !current?.gone;
				if (saveFocused && submit.disabled)
					(current?.gone ? keepNew : textInput).focus({ preventScroll: true });
				storageError.textContent = strings.storageError;
				storageError.hidden = !storageFailed;
				tabWarning.hidden = !draftStore.tabOnly;
				originWarning.hidden = !localConfig.draftOriginChanged;
				textInput.setAttribute(
					"aria-describedby",
					[
						error.id,
						!composerNotice.hidden && composerNotice.id,
						!storageError.hidden && storageError.id,
						!tabWarning.hidden && tabWarning.id,
						!originWarning.hidden && originWarning.id,
					]
						.filter(Boolean)
						.join(" "),
				);
				if (current) {
					var description = describe(current.anchor);
					if (
						preview.textContent !== description ||
						preview.firstElementChild?.localName !== (current.anchor.quote ? "blockquote" : "p")
					)
						preview.replaceChildren(
							element(current.anchor.quote ? "blockquote" : "p", "prx-review-quote", description),
						);
					composerTitle.textContent =
						strings.composerTitles[
							current.anchor.quote
								? "quote"
								: current.anchor.pin
									? "pin"
									: current.anchor.nodeId || current.anchor.blockId || current.anchor.cssPath
										? "block"
										: "page"
						];
				}
				updateCount(false);
				if (composer.open && storageFailed && !storageAnnounced) {
					storageAnnounced = true;
					announce(strings.storageError);
				}
			}
			function currentSubmission(record) {
				return current?.kind === "outbox" && current.record.requestId === record.requestId;
			}
			async function save() {
				if (loading || !current || isSending(current) || current.gone || configError) return;
				var original = current;
				if (original.kind === "draft") {
					original.body = textInput.value;
					if (original.body.length > localConfig.limits.body)
						return fieldError(strings.tooLong.replace("{limit}", localConfig.limits.body));
					if (!original.body.trim()) return fieldError(strings.emptyBody);
					if (
						new RegExp(localConfig.textRules.controls, "u").test(original.body) ||
						new RegExp(localConfig.textRules.surrogates, "u").test(original.body)
					)
						return fieldError(strings.invalidInput);
				}
				original.transferring = true;
				original.error = "";
				refreshComposer();
				var view = original,
					record,
					version = loadVersion;
				var pending = { view };
				pendingViews.add(pending);
				try {
					var transfer = await draftStore.send(original);
					if (transfer.status !== "outbox") {
						original.transferring = false;
						if (transfer.status === "editable") {
							if (current === original || (original.record && currentSubmission(original.record))) {
								current = transfer.session;
								if (transfer.session.notice) announce(transfer.session.notice);
								else fieldError(refusalErrors.get(original.record?.requestId) || strings.postError);
							}
							refusalErrors.delete(original.record?.requestId);
							renderDrafts();
							return;
						}
						if (transfer.record && current === original) {
							view = current = outboxSession(transfer.record);
							pending.view = view;
						}
						if (transfer.status === "gone") view.gone = true;
						resultNotice(view, transfer.status);
						return;
					}
					record = transfer.record;
					sendingRequests.add(record.requestId);
					view = outboxSession(record);
					pending.view = view;
					if (current === original) current = view;
					refreshComposer();
					renderDrafts();
					var response = await transport.create(record.anchor, record.body, record.requestId),
						saved = response.thread;
					var focusSaved = !composer.open || currentSubmission(record);
					await draftStore.ack(record);
					refusalErrors.delete(record.requestId);
					renderDrafts();
					if (currentSubmission(record)) {
						current = null;
						composer.close();
						refreshComposer();
					}
					if (version !== loadVersion) return;
					var existing = comments.findIndex((comment) => comment.id === saved.id);
					if (existing >= 0) comments[existing] = saved;
					else comments.push(saved);
					collapsed = false;
					renderComments();
					if (focusSaved) entries.find((entry) => entry.thread.id === saved.id)?.item.focus();
					status.textContent = response.replayed ? strings.alreadyPosted : strings.saved;
				} catch (failure) {
					if (!record) {
						resultNotice(original, "blocked");
						return;
					}
					var definitive =
						failure.status >= 400 &&
						failure.status < 500 &&
						[
							"invalid_input",
							"body_too_large",
							"limit_reached",
							"forbidden",
							"not_found",
							"request_id_reused",
						].includes(failure.message);
					if (definitive) {
						var reused = failure.message === "request_id_reused";
						if (reused) reusedRequests.add(record.requestId);
						refusalErrors.set(
							record.requestId,
							reused ? strings.draftPostedElsewhere : errorText(failure, strings.postError),
						);
						var editable, conversion;
						try {
							conversion = await draftStore.refuse(record, reused);
						} catch {
							resultNotice(view, "blocked");
							return;
						}
						editable = conversion.session;
						if (currentSubmission(record)) {
							if (editable) current = editable;
							else if (conversion.status === "blocked") resultNotice(current, "blocked");
							else {
								current.gone = true;
								current.notice = strings.draftChanged;
							}
						}
						renderDrafts();
					}
					if (currentSubmission(record) || (editable && current === editable)) {
						if (editable?.notice) announce(editable.notice);
						else fieldError(errorText(failure, strings.postError));
					} else if (version === loadVersion) {
						collapsed = false;
						updateToggle();
						status.textContent =
							editable?.notice ||
							(reused ? strings.draftPostedElsewhere : errorText(failure, strings.postError));
					}
					if (editable || conversion?.status === "gone") refusalErrors.delete(record.requestId);
				} finally {
					original.transferring = false;
					if (record) sendingRequests.delete(record.requestId);
					pendingViews.delete(pending);
					refreshComposer();
				}
			}

			var selectionButton = button("prx-review-selection", strings.commentAction, () => {
				var anchor = selectedRange && anchors.fromSelection(selectedRange);
				if (anchor) openComposer(anchor, selectionButton);
			});
			var selectionReason = element("span", "prx-review-visually-hidden");
			selectionReason.id = "prx-review-selection-reason";
			selectionReason.setAttribute("data-review-ui", "");
			selectionButton.hidden = true;
			selectionButton.addEventListener("mousedown", (event) => event.preventDefault());
			document.body.append(selectionButton, selectionReason);
			function updateSelection() {
				if (composer.open || picker.open || pinning) {
					selectionButton.hidden = true;
					return;
				}
				var selection = window.getSelection();
				if (!selection?.rangeCount || selection.isCollapsed) {
					if (document.activeElement !== selectionButton && document.activeElement !== choose) {
						selectionButton.hidden = true;
						selectedRange = null;
					}
					return;
				}
				var range = selection.getRangeAt(0);
				var owner =
					range.commonAncestorContainer.nodeType === 1
						? range.commonAncestorContainer
						: range.commonAncestorContainer.parentElement;
				if (
					!pageRoot().contains(owner) ||
					asReviewUI(owner) ||
					owner.closest("input,textarea,select,[contenteditable]") ||
					!anchors.usableText(
						range.startContainer.nodeType === 1
							? range.startContainer
							: range.startContainer.parentElement,
					) ||
					!anchors.usableText(
						range.endContainer.nodeType === 1
							? range.endContainer
							: range.endContainer.parentElement,
					)
				) {
					selectionButton.hidden = true;
					selectedRange = null;
					return;
				}
				selectedRange = range.cloneRange();
				var anchor = anchors.fromSelection(range);
				selectionButton.disabled = !anchor;
				selectionReason.textContent = anchor
					? ""
					: strings.selectionRefused.replace("{limit}", localConfig.limits.quoteExact);
				if (anchor) selectionButton.removeAttribute("aria-describedby");
				else selectionButton.setAttribute("aria-describedby", selectionReason.id);
				var rects = Array.from(range.getClientRects?.() || []),
					box = rects[rects.length - 1];
				if (!box) {
					selectionButton.hidden = true;
					return;
				}
				selectionButton.hidden = false;
				var width = selectionButton.getBoundingClientRect().width || 100;
				var left = Math.max(4, Math.min(innerWidth - width - 4, box.right + 4));
				var top = Math.max(4, Math.min(innerHeight - 48, box.bottom + 4));
				var blocked = [
					[left, top],
					[left + width, top],
					[left, top + 44],
					[left + width, top + 44],
				].some(([x, y]) => {
					var hit = document.elementFromPoint(x, y);
					if (hit === selectionButton || hit?.closest(".prx-review-overlay"))
						hit = document
							.elementsFromPoint?.(x, y)
							.find((node) => node !== selectionButton && !node.closest(".prx-review-overlay"));
					var root = pageRoot();
					return (
						!hit ||
						!(root.contains(hit) || hit.contains(root)) ||
						Boolean(hit.closest("dialog[open],[aria-modal='true'],.praxity-dialog-sheet"))
					);
				});
				selectionButton.hidden = blocked;
				selectionButton.style.left = `${left}px`;
				selectionButton.style.top = `${top}px`;
			}
			document.addEventListener("selectionchange", scheduleMarkers);
			var hint = element("div", "prx-review-pin-hint prx-review-visually-hidden");
			hint.setAttribute("data-review-ui", "");
			var hintText = element("p");
			hintText.setAttribute("role", "status");
			var hintCancel = button("prx-review-pin-cancel prx-review-action", strings.cancel, () =>
				exitPin(true),
			);
			hintCancel.hidden = true;
			hint.append(hintText, hintCancel);
			document.body.append(hint);
			function stopTouchStart(event) {
				if (!asReviewUI(event.target)) event.stopImmediatePropagation();
			}
			function enterPin(opener) {
				pinning = true;
				pinOpener = opener;
				pin.setAttribute("aria-pressed", "true");
				document.documentElement.classList.add("prx-review-pinning");
				hint.classList.remove("prx-review-visually-hidden");
				hintCancel.hidden = false;
				requestAnimationFrame(() => {
					if (pinning) hintText.textContent = strings.pinHint;
				});
				window.addEventListener("touchstart", stopTouchStart, { capture: true, passive: true });
				var rootBox = (isDeck ? deckWorkspace : pageRoot()).getBoundingClientRect();
				if (innerWidth < 480) {
					var dock = isDeck ? document.querySelector(".deck-controls") : sidebar;
					hint.style.top = "auto";
					hint.style.bottom = `${Math.max(12, innerHeight - (dock?.getBoundingClientRect().top ?? innerHeight) + 12)}px`;
				} else {
					hint.style.bottom = "auto";
					hint.style.top = `${Math.max(0, rootBox.top)}px`;
				}
				updateSelection();
			}
			function exitPin(returnFocus) {
				touchClick = null;
				if (!pinning) return;
				pinning = false;
				pin.setAttribute("aria-pressed", "false");
				hint.classList.add("prx-review-visually-hidden");
				hintCancel.hidden = true;
				hintText.textContent = "";
				window.removeEventListener("touchstart", stopTouchStart, true);
				document.documentElement.classList.remove("prx-review-pinning");
				if (returnFocus) restoreFocus(pinOpener);
			}
			var touchClick = null;
			["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"].forEach((name) => {
				window.addEventListener(
					name,
					(event) => {
						if (
							name === "click" &&
							touchClick &&
							event.target === touchClick.target &&
							performance.now() < touchClick.until
						) {
							event.preventDefault();
							event.stopImmediatePropagation();
							touchClick = null;
							return;
						}
						if (name === "click") touchClick = null;
						if (!pinning || asReviewUI(event.target)) return;
						event.preventDefault();
						event.stopImmediatePropagation();
						var touch = name === "pointerup" && event.pointerType === "touch";
						if (name !== "click" && !touch) return;
						var anchor = anchors.fromPin(event.target, event.clientX, event.clientY);
						if (!anchor) {
							hintText.textContent = "";
							queueMicrotask(() => {
								hintText.textContent = strings.pinRefused;
							});
							return;
						}
						openComposer(anchor, pinOpener);
						if (touch) touchClick = { target: event.target, until: performance.now() + 1000 };
					},
					{ capture: true, passive: false },
				);
			});
			window.addEventListener(
				"keydown",
				(event) => {
					if (pinning && event.key === "Escape") {
						event.preventDefault();
						event.stopImmediatePropagation();
						exitPin(true);
					}
				},
				true,
			);
			// Let the native dialog handle Tab, Escape and editing before isolating course shortcuts.
			["keydown", "keyup", "keypress"].forEach((name) => {
				[composer, picker].forEach((node) =>
					node.addEventListener(name, (event) => event.stopPropagation()),
				);
			});
			window.addEventListener(
				"pagehide",
				() => {
					keepDraft();
					exitPin(false);
				},
				{ once: true },
			);
			window.addEventListener("beforeunload", (event) => {
				if (draftStore.hasPending()) {
					event.preventDefault();
					event.returnValue = "";
				}
			});
			renderDrafts();
			return {
				placeActions,
				refreshComposer,
				updateSelection,
				draftCount: () => draftStore.list(activePageId).length,
				save,
				pageChange() {
					closeComposer(false);
					if (picker.open) picker.close();
					exitPin(false);
					selectedRange = null;
					selectionButton.hidden = true;
				},
				renderDrafts,
			};
		}

		toggle.addEventListener("click", () => {
			collapsed = !collapsed;
			updateToggle();
		});

		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (reviewTools) {
				reviewTools.save();
				return;
			}
			if (loading || posting) return;
			var version = loadVersion;
			var name = nameInput.value.trim();
			var submittedDraft = textInput.value;
			var text = submittedDraft.trim();
			if (!name || !text || configError) return;

			var submitted = {
				page: activePageId,
				pageHeading: pageHeading || undefined,
				name: name,
				text: text,
			};
			error.hidden = true;
			posting = true;
			submit.disabled = true;
			submit.textContent = strings.posting;

			transport
				.post(submitted)
				.then((saved) => {
					// Navigation invalidates the list response, not the saved draft.
					if (textInput.value === submittedDraft) textInput.value = "";
					if (version !== loadVersion) return;
					comments.push(saved);
					renderComments();
					status.classList.add("praxity-a11y-sr-only");
					status.textContent = strings.postSuccess;
				})
				.catch((failure) => {
					if (version !== loadVersion) return;
					error.textContent = errorText(failure, strings.postError);
					error.hidden = false;
					renderComments();
				})
				.finally(() => {
					posting = false;
					submit.disabled = loading;
					submit.textContent = strings.post;
				});
		});

		function selectPage(id) {
			if (reviewTools) reviewTools.pageChange();
			var slide = Array.from(document.querySelectorAll("[data-deck-slide]")).find(
				(node) => node.getAttribute("data-deck-slide") === id,
			);
			var heading = (slide || document.querySelector("main"))?.querySelector(
				"h1, h2, h3, h4, h5, h6, .praxity-assessment-stem",
			);
			pageHeading = heading?.textContent?.trim() || slide?.getAttribute("aria-label") || "";
			if (!reviewTools) {
				context.textContent = pageHeading ? `${strings.commentingOn} ${pageHeading}` : "";
				context.hidden = !pageHeading;
			}
			activePageId = id;
			if (reviewTools) reviewTools.renderDrafts();
			comments = [];
			renderComments();
			error.hidden = true;
			status.textContent = strings.loading;
			var version = ++loadVersion;
			loading = true;
			submit.disabled = true;
			if (configError || (anchors && !activePageId)) {
				status.textContent = strings.loadError;
				return;
			}
			transport
				.list(activePageId)
				.then((loaded) => {
					if (version !== loadVersion) return;
					comments = loaded;
					renderComments();
				})
				.catch((failure) => {
					if (version !== loadVersion) return;
					status.textContent = errorText(failure, strings.loadError);
				})
				.finally(() => {
					if (version !== loadVersion) return;
					loading = false;
					if (reviewTools) reviewTools.refreshComposer();
					else submit.disabled = posting;
				});
		}

		window.addEventListener("praxity:active-page-change", (event) => {
			var id = event.detail?.pageId;
			if (typeof id === "string" && id && id !== activePageId) selectPage(id);
		});
		var initialSlide = document.querySelector("[data-deck-slide]:not([hidden])");
		selectPage(initialSlide?.getAttribute("data-deck-slide") || config.pageId);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
