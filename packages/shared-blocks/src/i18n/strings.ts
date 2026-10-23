import { strings as selfCheckStrings } from "learning-patterns/patterns/self-check/strings.js";
import { nextPageUnavailable } from "./completion-gate-strings";
import { DONT_KNOW_LABELS } from "./dont-know-labels";
import { journalDownloadLabels } from "./journal-download-labels";
import { resolveLocale } from "./locale";
import { selfCheckActivationStrings } from "./self-check-host-strings";

export { interpolate } from "./interpolate";
export { type SupportedLocale, supportedLocales } from "./locale";

export interface LearnerStrings {
	// Navigation
	next: string;
	previous: string;
	nextPage: string;
	nextPageUnavailable: string;
	previousPage: string;
	pageOf: string;
	moduleOf: string;
	nextModule: string;
	previousModule: string;
	scormResumeAnnouncement: string;
	deckResumeAnnouncement: string;
	scormResumePositionPrefix: string;
	deckResumePositionPrefix: string;
	skipToContent: string;
	skipToPageNavigation: string;
	pageNavigation: string;
	courseProgress: string;
	pageScrollProgress: string;
	sectionNavigation: string;
	coursePages: string;
	courseReference: string;
	openCourseMenu: string;
	courseNavigation: string;
	courseProgressPageOf: string;
	pageCount: string;
	completed: string;
	visitedPage: string;
	visitedModule: string;
	glossaryHeading: string;
	fullGlossary: string;
	backToTheCourse: string;
	backToCourse: string;
	courseComplete: string;
	reviewCourse: string;
	courseTimeSpent: string;
	courseTimeLessThanMinute: string;
	courseTimeUnavailable: string;
	courseRecordedScore: string;
	courseScoreWithPassMark: string;
	definitionAvailable: string;
	footnote: string;
	footnotes: string;

	// Narration
	play: string;
	pause: string;
	seek: string;
	durationLoading: string;
	durationUnavailable: string;
	speed: string;
	captions: string;
	transcript: string;
	narrationLabel: string;
	narrationOptions: string;
	noNarration: string;
	listen: string;
	previousSentence: string;
	nextSentence: string;
	followNarration: string;
	showAll: string;

	// Assessment
	submit: string;
	check: string;
	completeReflection: string;
	downloadResponseAs: string;
	downloadTxt: string;
	downloadDocx: string;
	rowShouldBe: string;
	rowsCorrect: string;
	correct: string;
	incorrect: string;
	notQuite: string;
	dontKnow: string;
	dontKnowChosen: string;
	assessmentGroupUnknown: string;
	continueActivity: string;
	correctAnswer: string;
	correctAnswers: string;
	tryAgain: string;
	assessmentAttemptOf: string;
	assessmentAttemptsUsed: string;
	assessmentStorageNotice: string;
	showAnswer: string;
	yourAnswer: string;
	/** Label shown below ungraded text response (reflection). */
	reflectionPrivateLabel: string;

	// Flashcard / carousel
	previousCard: string;
	nextCard: string;
	previousSlide: string;
	nextSlide: string;
	flipCard: string;
	sequenceLabel: string;
	sequenceStepsLabel: string;
	sequenceTimelineLabel: string;
	sequenceEmpty: string;
	sequenceScrollRegion: string;
	tableScrollHint: string;
	sequenceScrollPrevious: string;
	sequenceScrollNext: string;

	// Certificate
	certificateEarned: string;
	congratulations: string;
	downloadPdf: string;
	shareOnLinkedIn: string;
	copyVerificationLink: string;
	copied: string;

	returnToCourse: string;

	// Rating
	submitRating: string;
	thankYou: string;

	// General
	required: string;
	loading: string;
	close: string;
	videoLabel: string;
	buttonLabel: string;
	sectionLabel: string;
	tabLabel: string;
	questionLabel: string;
	optionLabel: string;
	checklistLabel: string;
	itemLabel: string;
	noteType: string;
	infoNoteType: string;
	tipNoteType: string;
	successNoteType: string;
	warningNoteType: string;
	errorNoteType: string;
	noteAriaLabel: string;
	audioContent: string;
	audioLabel: string;
	videoContent: string;
	tabbedContentSections: string;
	copyCodeToClipboard: string;
	codeRegion: string;
	copyLabel: string;
	copiedToClipboard: string;
	codeExample: string;
	codeExampleIn: string;
	imageComparisonSlider: string;
	uploadComparisonImages: string;
	dataTable: string;
	labeledGraphicLabel: string;
	expandableContentSections: string;
	logicRuleLabel: string;
	logicActionsLabel: string;
	logicOperatorAnd: string;
	logicOperatorOr: string;
	logicNoConditionsDefined: string;
	logicNoActionsDefined: string;
	logicNoTargets: string;
	logicComparisonIs: string;
	logicComparisonIsNot: string;
	logicComparisonGt: string;
	logicComparisonLt: string;
	logicComparisonGte: string;
	logicComparisonLte: string;
	logicComparisonContains: string;
	logicComparisonDoesNotContain: string;
	logicComparisonStartsWith: string;
	logicComparisonDoesNotStartWith: string;
	logicComparisonEndsWith: string;
	logicComparisonDoesNotEndWith: string;
	logicComparisonIsEmpty: string;
	logicComparisonIsNotEmpty: string;
	logicComparisonIsAnyOf: string;
	logicComparisonIsNotAnyOf: string;
	logicComparisonIsEveryOf: string;
	logicActionShow: string;
	logicActionHide: string;
	logicActionJumpTo: string;
	logicActionSet: string;
	logicActionTo: string;
	logicActionRequireCompletionOf: string;
	logicActionDisableCompletion: string;
	logicAuthoringOverlay: string;
	logicCondition: string;
	logicConditions: string;
	logicAction: string;
	logicActions: string;

	// Document
	documentFallbackTitle: string;
	noDocumentUploaded: string;
	documentDownload: string;
	resourceOpenLink: string;

	// External link
	opensInNewTab: string;
	viewTranscript: string;
	videoUnavailableFallback: string;
	openVideoSource: string;
	mediaOpen: string;
	mediaShowEmbed: string;

	// Assessment aria-labels
	selectAnAnswer: string;
	selectAllThatApply: string;
	selectAMatch: string;
	matchFor: string;
	selectACategory: string;
	categoryFor: string;
	categoryChoiceFor: string;
	categorizeItemsColumn: string;
	moveUp: string;
	moveDown: string;
	orderItemPosition: string;
	orderItemMoved: string;
	orderSortableItem: string;
	selfCheckAnswer: string;
	selfCheckCheck: string;
	selfCheckShowFeedback: string;
	selfCheckStartOver: string;
	selfCheckNeedsScript: string;
	typeYourAnswer: string;
	enterANumber: string;
	assessmentEnterResponse: string;
	assessmentReviewReady: string;
	assessmentQuestion: string;
	assessmentBlankLabel: string;
	assessmentWordBank: string;
	assessmentPoint: string;
	assessmentNeedsScript: string;
	assessmentPoints: string;
	feedbackLabel: string;
	noQuestionText: string;
	previewNotAvailable: string;
	hotspotLabel: string;
	hotspotSelectionCount: string;
	hotspotSelectionPrompt: string;
	/** Labeled graphic helper prompt. */
	labeledGraphicClickToReveal: string;
	/** Explains the numbered order and availability of sequential pins. */
	labeledGraphicSequentialInstruction: string;
	/** Labeled graphic reveal progress text. */
	labeledGraphicProgress: string;

	// Flashcard
	nowShowingBack: string;
	nowShowingFront: string;
	flashcardInteraction: string;
	flashcardAriaLabel: string;
	turnCard: string;
	backToFront: string;
	playCards: string;
	pauseCards: string;
	cardAnnouncement: string;

	// Rating
	rateValueOf: string;
	ratingLabel: string;

	// Slides
	slideAnnouncement: string;
	noSlides: string;
	slidesLabel: string;
	chooseSlide: string;
	goToSlide: string;

	// Signature
	signatureLabel: string;
	signatureMethod: string;
	signatureDraw: string;
	signatureType: string;
	signatureDrawn: string;
	drawYourSignature: string;
	signatureKeyboardHint: string;
	signatureMethodLocked: string;
	signedAt: string;
	clearSignature: string;

	// Assessment group
	untitledGroup: string;
	groupModeOneOf: string;
	groupModeAll: string;
	groupMember: string;
	groupMembers: string;
	assessmentGroupResultsSummary: string;
	assessmentGroupCorrect: string;
	assessmentGroupReview: string;
	assessmentGroupQuestionReview: string;
	assessmentGroupPassingScore: string;
	assessmentGroupProgress: string;
	assessmentGroupChooseOne: string;
	assessmentGroupSubmitSelected: string;
	assessmentGroupSubmitAll: string;
	assessmentGroupCheckSelected: string;
	assessmentGroupCheckAll: string;
	assessmentGroupQuestionFallback: string;
	assessmentGroupScore: string;
	assessmentGroupPassed: string;
	assessmentGroupNotPassed: string;
	assessmentGroupRequiredError: string;
	assessmentGroupSaved: string;

	// Sidebar
	courseControls: string;
	courseOutline: string;
	closeCourseOutline: string;
	collapseSidebar: string;
	expandSidebar: string;

	// Resources Tab
	resourcesHeading: string;
	resourceDocumentsHeading: string;
	resourceExternalLinksHeading: string;
	resourceLessonPdfsHeading: string;
	resourceCourseDocumentsHeading: string;
	resourceFromLesson: string;
	untitledResource: string;

	// Generic
	interaction: string;

	// Columns preset headers
	columnsPresetBefore: string;
	columnsPresetAfter: string;
	columnsPresetOptionA: string;
	columnsPresetOptionB: string;

	// Page title treatment
	/** Label above the page title on the first page of each lesson. {n} = lesson number. */
	lessonLabel: string;
	/** Section status in the narrative context bar. */
	narrativeSectionPosition: string;
	/** Read-time hint in the narrative context bar. */
	narrativeReadTime: string;

	// Accessibility preferences bar
	a11yPreferences: string;
	a11yLargerText: string;
	a11yLargerTextEnabled: string;
	a11yLargerTextDisabled: string;
	a11yFocusReading: string;
	a11yFocusReadingEnabled: string;
	a11yFocusReadingDisabled: string;
}

const en: LearnerStrings = {
	next: "Next",
	previous: "Previous",
	nextPage: "Next page",
	nextPageUnavailable: nextPageUnavailable.en,
	previousPage: "Previous page",
	pageOf: "Page {current} of {total}",
	moduleOf: "Module {current} of {total}",
	nextModule: "Next Module",
	previousModule: "Previous Module",
	scormResumeAnnouncement: "Resumed at page {current} of {total}: {title}",
	deckResumeAnnouncement: "Resumed at slide {current} of {total}: {title}",
	// The prefix is its own line inside the heading. Layout drops a trailing ordinary
	// space there, and NVDA then reads "6:Build"; a non-breaking space survives.
	scormResumePositionPrefix: "Resumed at page {current} of {total}: ",
	deckResumePositionPrefix: "Resumed at slide {current} of {total}: ",
	skipToContent: "Skip to content",
	skipToPageNavigation: "Skip to page navigation",
	pageNavigation: "Pages",
	courseProgress: "Course progress",
	pageScrollProgress: "Page scroll progress",
	sectionNavigation: "Section navigation",
	coursePages: "Course pages",
	courseReference: "Course reference",
	openCourseMenu: "Open course menu",
	courseNavigation: "Course",
	courseProgressPageOf: "Course progress: page {current} of {total}",
	pageCount: "{count} pages",
	completed: "Completed",
	visitedPage: "Visited",
	visitedModule: "Visited",
	glossaryHeading: "Glossary",
	fullGlossary: "Full glossary",
	backToTheCourse: "Back to the course",
	backToCourse: "Back to course",
	courseComplete: "Course complete",
	reviewCourse: "Review course",
	courseTimeSpent: "Time spent: {duration}",
	courseTimeLessThanMinute: "less than a minute",
	courseTimeUnavailable: "Time spent unavailable",
	courseRecordedScore: "Score: {score} / {max}",
	courseScoreWithPassMark: "Score: {score} / {max} · Pass mark: {passMark}",
	definitionAvailable: "has definition",
	footnote: "Footnote",
	footnotes: "Sources",

	play: "Play",
	pause: "Pause",
	seek: "Position in narration",
	durationLoading: "Loading narration duration…",
	durationUnavailable: "Narration duration unavailable",
	speed: "Playback speed",
	captions: "Captions",
	transcript: "Transcript",
	narrationLabel: "Narration",
	narrationOptions: "Narration options",
	noNarration: "No narration on this slide",
	listen: "Listen",
	previousSentence: "Previous sentence",
	nextSentence: "Next sentence",
	followNarration: "Follow narration",
	showAll: "Show all",

	submit: "Submit",
	check: "Check",
	completeReflection: "Complete reflection",
	...journalDownloadLabels.en,
	rowShouldBe: "Should be: {category}",
	rowsCorrect: "{correct} of {total} correct",
	correct: "Correct",
	incorrect: "Incorrect",
	notQuite: "Not quite",
	dontKnow: DONT_KNOW_LABELS.en,
	dontKnowChosen: 'You chose "I don\'t know"',
	assessmentGroupUnknown: ', {unknown} "I don\'t know"',
	continueActivity: "Continue",
	correctAnswer: "Correct answer",
	correctAnswers: "Correct answers",
	tryAgain: "Try again",
	assessmentAttemptOf: "Attempt {n} of {total}",
	assessmentAttemptsUsed: "{n} of {total} attempts used",
	assessmentStorageNotice:
		"This answer could not be saved. Your previously saved progress is kept.",
	showAnswer: "Show answer",
	yourAnswer: "Your answer",
	reflectionPrivateLabel: "Your reflection is private",

	previousCard: "Previous card",
	nextCard: "Next card",
	previousSlide: "Previous slide",
	nextSlide: "Next slide",
	flipCard: "Flip card",
	sequenceLabel: "Sequence",
	sequenceStepsLabel: "Steps",
	sequenceTimelineLabel: "Timeline",
	sequenceEmpty: "No steps",
	sequenceScrollRegion: "Scrollable sequence",
	tableScrollHint: "Scroll for more",
	sequenceScrollPrevious: "Scroll sequence left",
	sequenceScrollNext: "Scroll sequence right",

	certificateEarned: "Certificate Earned!",
	congratulations: "Congratulations",
	downloadPdf: "Download PDF",
	shareOnLinkedIn: "Share on LinkedIn",
	copyVerificationLink: "Copy Verification Link",
	copied: "Copied!",

	returnToCourse: "Return to Course",

	submitRating: "Submit Rating",
	thankYou: "Thank you!",

	required: "Required",
	loading: "Loading…",
	close: "Close",
	videoLabel: "Video",
	buttonLabel: "Button",
	sectionLabel: "Section {index}",
	tabLabel: "Tab {index}",
	questionLabel: "Question",
	optionLabel: "Option {index}",
	checklistLabel: "Checklist",
	itemLabel: "Item {index}",
	noteType: "Note",
	infoNoteType: "Info",
	tipNoteType: "Tip",
	successNoteType: "Success",
	warningNoteType: "Warning",
	errorNoteType: "Error",
	noteAriaLabel: "{type} note",
	audioContent: "Audio content",
	audioLabel: "Audio",
	videoContent: "Video content",
	tabbedContentSections: "Tabbed content sections",
	copyCodeToClipboard: "Copy code to clipboard",
	codeRegion: "Code",
	copyLabel: "Copy",
	copiedToClipboard: "Copied to clipboard",
	codeExample: "Code example: {title}",
	codeExampleIn: "Code example in {language}",
	imageComparisonSlider: "Image comparison slider",
	uploadComparisonImages: "Upload before and after images",
	dataTable: "Data table",
	labeledGraphicLabel: "Labeled graphic",
	expandableContentSections: "Expandable content sections",
	logicRuleLabel: "Logic rule",
	logicActionsLabel: "Actions",
	logicOperatorAnd: "AND",
	logicOperatorOr: "OR",
	logicNoConditionsDefined: "No conditions defined.",
	logicNoActionsDefined: "No actions defined.",
	logicNoTargets: "none",
	logicComparisonIs: "is",
	logicComparisonIsNot: "is not",
	logicComparisonGt: ">",
	logicComparisonLt: "<",
	logicComparisonGte: ">=",
	logicComparisonLte: "<=",
	logicComparisonContains: "contains",
	logicComparisonDoesNotContain: "does not contain",
	logicComparisonStartsWith: "starts with",
	logicComparisonDoesNotStartWith: "does not start with",
	logicComparisonEndsWith: "ends with",
	logicComparisonDoesNotEndWith: "does not end with",
	logicComparisonIsEmpty: "is empty",
	logicComparisonIsNotEmpty: "is not empty",
	logicComparisonIsAnyOf: "is any of",
	logicComparisonIsNotAnyOf: "is not any of",
	logicComparisonIsEveryOf: "includes every of",
	logicActionShow: "show",
	logicActionHide: "hide",
	logicActionJumpTo: "jump to",
	logicActionSet: "set",
	logicActionTo: "to",
	logicActionRequireCompletionOf: "require completion of",
	logicActionDisableCompletion: "disable course completion",
	logicAuthoringOverlay: "Authoring logic",
	logicCondition: "condition",
	logicConditions: "conditions",
	logicAction: "action",
	logicActions: "actions",

	// Document
	documentFallbackTitle: "Document",
	noDocumentUploaded: "No document uploaded",
	documentDownload: "Download",
	resourceOpenLink: "Open link",

	// External link
	opensInNewTab: "(opens in a new tab)",
	viewTranscript: "View transcript",
	videoUnavailableFallback: "Video unavailable in embedded player.",
	openVideoSource: "Open video source",
	mediaOpen: "Open {title}",
	mediaShowEmbed: "Show embedded content",

	selectAnAnswer: "Select an answer",
	selectAllThatApply: "Select all that apply",
	selectAMatch: "Select a match...",
	matchFor: "Match for: {prompt}",
	selectACategory: "Select a category...",
	categoryFor: "Category for: {item}",
	categoryChoiceFor: "{item}: {category}",
	categorizeItemsColumn: "Items",
	moveUp: "Move {label} up",
	moveDown: "Move {label} down",
	orderItemPosition: "Position {position} of {total}",
	orderItemMoved: "{label} moved to position {position} of {total}",
	orderSortableItem: "sortable item",
	selfCheckAnswer: selfCheckStrings.en.answer,
	selfCheckCheck: selfCheckStrings.en.check,
	selfCheckShowFeedback: selfCheckStrings.en.show,
	selfCheckStartOver: selfCheckActivationStrings.en.selfCheckStartOver,
	selfCheckNeedsScript: "Comparing your answer with the model requires JavaScript.",
	typeYourAnswer: "Type your answer...",
	enterANumber: "Enter a number...",
	assessmentEnterResponse: "Enter a response before submitting",
	assessmentReviewReady: "Answer checked. Review the results above.",
	assessmentQuestion: "Assessment question",
	assessmentWordBank: "Word bank: {words}. Use each entry once.",
	assessmentBlankLabel: "Blank {current} of {total}, after “{context}”",
	assessmentNeedsScript:
		"Answering this question needs JavaScript. Turn it on to answer and see feedback.",
	assessmentPoint: "{points} point",
	assessmentPoints: "{points} points",
	feedbackLabel: "Feedback",
	noQuestionText: "No question text",
	previewNotAvailable: "Preview not available for this assessment type",
	hotspotLabel: "Hotspot {index}",
	hotspotSelectionCount: "{selected} of {total} regions selected",
	hotspotSelectionPrompt: "{total} regions. Select a region.",
	labeledGraphicClickToReveal: "Select the numbered pins to explore",
	labeledGraphicSequentialInstruction:
		"Explore the numbered pins in order. Later pins become available after the preceding pin.",
	labeledGraphicProgress: "{revealed} of {total} revealed",

	nowShowingBack: "Now showing back",
	nowShowingFront: "Now showing front",
	flashcardInteraction: "Flashcard interaction",
	flashcardAriaLabel: "Flashcard {current} of {total}, {side}. Click to flip",
	turnCard: "I have my answer",
	backToFront: "Hide answer",
	playCards: "Play cards",
	pauseCards: "Pause cards",
	cardAnnouncement: "Card {current} of {total}",

	rateValueOf: "Rate {value} of {count}",
	ratingLabel: "Rating",

	slideAnnouncement: "Slide {current} of {total}",
	noSlides: "No slides",
	slidesLabel: "Slides",
	chooseSlide: "Choose slide to display",
	goToSlide: "Go to slide {index}",

	signatureLabel: "Signature",
	signatureMethod: "Signature method",
	signatureDraw: "Draw",
	signatureType: "Type",
	signatureDrawn: "Signature drawn",
	signatureMethodLocked: "Clear your signature to change the signing method.",
	drawYourSignature: "Draw your signature",
	signatureKeyboardHint: "Press Enter or Space to switch to typing your signature.",
	signedAt: "Signed {date}",
	clearSignature: "Clear",

	untitledGroup: "Untitled Group",
	groupModeOneOf: "One of",
	groupModeAll: "All",
	groupMember: "member",
	groupMembers: "members",
	assessmentGroupResultsSummary: "Results",
	assessmentGroupCorrect: "{correct} of {total} correct",
	assessmentGroupReview: "Review questions",
	assessmentGroupQuestionReview: "Question {index}: {stem}",
	assessmentGroupPassingScore: "Passing score: {score}%",
	assessmentGroupProgress: "Questions completed: {completed} of {total}",
	assessmentGroupChooseOne: "Choose one",
	assessmentGroupSubmitSelected: "Submit selected",
	assessmentGroupSubmitAll: "Submit all",
	assessmentGroupCheckSelected: "Check selected",
	assessmentGroupCheckAll: "Check all",
	assessmentGroupQuestionFallback: "Question {index}",
	assessmentGroupScore: "Score: {score}%",
	assessmentGroupPassed: "Passed",
	assessmentGroupNotPassed: "Not passed",
	assessmentGroupRequiredError: "Answer all required questions before submitting.",
	assessmentGroupSaved: "Responses saved",

	courseControls: "Course controls",
	courseOutline: "Course outline",
	closeCourseOutline: "Close outline",
	collapseSidebar: "Collapse sidebar",
	expandSidebar: "Expand sidebar",

	resourcesHeading: "Resources",
	resourceDocumentsHeading: "Documents",
	resourceExternalLinksHeading: "External Links",
	resourceLessonPdfsHeading: "Lesson PDFs",
	resourceCourseDocumentsHeading: "Course Documents",
	resourceFromLesson: "From {lesson}",
	untitledResource: "Untitled",

	interaction: "Interaction",
	columnsPresetBefore: "Before",
	columnsPresetAfter: "After",
	columnsPresetOptionA: "Option A",
	columnsPresetOptionB: "Option B",

	lessonLabel: "Lesson {n}",
	narrativeSectionPosition: "Section {current} of {total}",
	narrativeReadTime: "~{minutes} min",
	a11yPreferences: "Reading preferences",
	a11yLargerText: "Larger text",
	a11yLargerTextEnabled: "Larger text enabled",
	a11yLargerTextDisabled: "Larger text disabled",
	a11yFocusReading: "Reading guide",
	a11yFocusReadingEnabled: "Reading guide enabled",
	a11yFocusReadingDisabled: "Reading guide disabled",
};

const fr: LearnerStrings = {
	next: "Suivant",
	previous: "Précédent",
	nextPage: "Page suivante",
	nextPageUnavailable: nextPageUnavailable.fr,
	previousPage: "Page précédente",
	pageOf: "Page {current} sur {total}",
	moduleOf: "Module {current} sur {total}",
	nextModule: "Module suivant",
	previousModule: "Module précédent",
	// French puts a non-breaking space before a colon; the cue's colon must not wrap alone.
	scormResumeAnnouncement: "Reprise à la page {current} sur {total} : {title}",
	deckResumeAnnouncement: "Reprise à la diapositive {current} sur {total} : {title}",
	scormResumePositionPrefix: "Reprise à la page {current} sur {total} : ",
	deckResumePositionPrefix: "Reprise à la diapositive {current} sur {total} : ",
	skipToContent: "Aller au contenu",
	skipToPageNavigation: "Aller à la navigation des pages",
	pageNavigation: "Pages",
	courseProgress: "Progression dans le cours",
	pageScrollProgress: "Progression du défilement de la page",
	sectionNavigation: "Navigation des sections",
	coursePages: "Pages du cours",
	courseReference: "Références du cours",
	openCourseMenu: "Ouvrir le menu du cours",
	courseNavigation: "Cours",
	courseProgressPageOf: "Progression dans le cours : page {current} sur {total}",
	pageCount: "{count} pages",
	completed: "Terminé",
	visitedPage: "Consultée",
	visitedModule: "Consulté",
	glossaryHeading: "Glossaire",
	fullGlossary: "Glossaire complet",
	backToTheCourse: "Retour au cours",
	backToCourse: "Retour au cours",
	courseComplete: "Cours terminé",
	reviewCourse: "Revoir le cours",
	courseTimeSpent: "Temps passé : {duration}",
	courseTimeLessThanMinute: "moins d'une minute",
	courseTimeUnavailable: "Temps passé indisponible",
	courseRecordedScore: "Score : {score} / {max}",
	courseScoreWithPassMark: "Score : {score} / {max} · Seuil de réussite : {passMark}",
	definitionAvailable: "a une définition",
	footnote: "Note",
	footnotes: "Sources",

	play: "Lecture",
	pause: "Pause",
	seek: "Position dans la narration",
	durationLoading: "Chargement de la durée de la narration…",
	durationUnavailable: "Durée de la narration indisponible",
	speed: "Vitesse de lecture",
	captions: "Sous-titres",
	transcript: "Transcription",
	narrationLabel: "Narration",
	narrationOptions: "Options de narration",
	noNarration: "Aucune narration sur cette diapositive",
	listen: "Écouter",
	previousSentence: "Phrase précédente",
	nextSentence: "Phrase suivante",
	followNarration: "Suivre la narration",
	showAll: "Tout afficher",

	submit: "Soumettre",
	check: "Vérifier",
	completeReflection: "Terminer la réflexion",
	...journalDownloadLabels.fr,
	rowShouldBe: "Réponse attendue : {category}",
	rowsCorrect: "{correct} sur {total} corrects",
	correct: "Correct",
	incorrect: "Incorrect",
	notQuite: "Pas tout à fait",
	dontKnow: DONT_KNOW_LABELS.fr,
	dontKnowChosen: "Vous avez choisi « Je ne sais pas »",
	assessmentGroupUnknown: ", {unknown} « Je ne sais pas »",
	continueActivity: "Continuer",
	correctAnswer: "Bonne réponse",
	correctAnswers: "Bonnes réponses",
	tryAgain: "Réessayer",
	assessmentAttemptOf: "Tentative {n} sur {total}",
	assessmentAttemptsUsed: "Tentatives utilisées\u00a0: {n} sur {total}",
	assessmentStorageNotice:
		"Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée.",
	showAnswer: "Afficher la réponse",
	yourAnswer: "Votre réponse",
	reflectionPrivateLabel: "Votre réflexion est privée",

	previousCard: "Carte précédente",
	nextCard: "Carte suivante",
	previousSlide: "Diapositive précédente",
	nextSlide: "Diapositive suivante",
	flipCard: "Retourner la carte",
	sequenceLabel: "Séquence",
	sequenceStepsLabel: "Étapes",
	sequenceTimelineLabel: "Chronologie",
	sequenceEmpty: "Aucune étape",
	sequenceScrollRegion: "Séquence défilante",
	tableScrollHint: "Faire défiler pour en voir plus",
	sequenceScrollPrevious: "Faire défiler la séquence vers la gauche",
	sequenceScrollNext: "Faire défiler la séquence vers la droite",

	certificateEarned: "Certificat obtenu !",
	congratulations: "Félicitations",
	downloadPdf: "Télécharger le PDF",
	shareOnLinkedIn: "Partager sur LinkedIn",
	copyVerificationLink: "Copier le lien de vérification",
	copied: "Copié !",

	returnToCourse: "Retourner au cours",

	submitRating: "Soumettre l'évaluation",
	thankYou: "Merci !",

	required: "Obligatoire",
	loading: "Chargement…",
	close: "Fermer",
	videoLabel: "Vidéo",
	buttonLabel: "Bouton",
	sectionLabel: "Section {index}",
	tabLabel: "Onglet {index}",
	questionLabel: "Question",
	optionLabel: "Option {index}",
	checklistLabel: "Liste de vérification",
	itemLabel: "Élément {index}",
	noteType: "Note",
	infoNoteType: "Info",
	tipNoteType: "Conseil",
	successNoteType: "Succès",
	warningNoteType: "Avertissement",
	errorNoteType: "Erreur",
	noteAriaLabel: "Note de type {type}",
	audioContent: "Contenu audio",
	audioLabel: "Audio",
	videoContent: "Contenu vidéo",
	tabbedContentSections: "Sections de contenu à onglets",
	copyCodeToClipboard: "Copier le code dans le presse-papiers",
	codeRegion: "Code",
	copyLabel: "Copier",
	copiedToClipboard: "Copié dans le presse-papiers",
	codeExample: "Exemple de code : {title}",
	codeExampleIn: "Exemple de code en {language}",
	imageComparisonSlider: "Curseur de comparaison d’images",
	uploadComparisonImages: "Téléversez les images avant et après",
	dataTable: "Tableau de données",
	labeledGraphicLabel: "Image annotée",
	expandableContentSections: "Sections de contenu extensibles",
	logicRuleLabel: "Règle logique",
	logicActionsLabel: "Actions",
	logicOperatorAnd: "ET",
	logicOperatorOr: "OU",
	logicNoConditionsDefined: "Aucune condition définie.",
	logicNoActionsDefined: "Aucune action définie.",
	logicNoTargets: "aucune",
	logicComparisonIs: "est",
	logicComparisonIsNot: "n'est pas",
	logicComparisonGt: ">",
	logicComparisonLt: "<",
	logicComparisonGte: ">=",
	logicComparisonLte: "<=",
	logicComparisonContains: "contient",
	logicComparisonDoesNotContain: "ne contient pas",
	logicComparisonStartsWith: "commence par",
	logicComparisonDoesNotStartWith: "ne commence pas par",
	logicComparisonEndsWith: "se termine par",
	logicComparisonDoesNotEndWith: "ne se termine pas par",
	logicComparisonIsEmpty: "est vide",
	logicComparisonIsNotEmpty: "n'est pas vide",
	logicComparisonIsAnyOf: "est l'un de",
	logicComparisonIsNotAnyOf: "n'est aucun de",
	logicComparisonIsEveryOf: "inclut tous les éléments de",
	logicActionShow: "afficher",
	logicActionHide: "masquer",
	logicActionJumpTo: "aller à",
	logicActionSet: "définir",
	logicActionTo: "à",
	logicActionRequireCompletionOf: "exiger la complétion de",
	logicActionDisableCompletion: "désactiver la complétion du cours",
	logicAuthoringOverlay: "Logique de création",
	logicCondition: "condition",
	logicConditions: "conditions",
	logicAction: "action",
	logicActions: "actions",

	// Document
	documentFallbackTitle: "Document",
	noDocumentUploaded: "Aucun document téléversé",
	documentDownload: "Télécharger",
	resourceOpenLink: "Ouvrir le lien",

	// External link
	opensInNewTab: "(s’ouvre dans un nouvel onglet)",
	viewTranscript: "Voir la transcription",
	videoUnavailableFallback: "Vidéo indisponible dans le lecteur intégré.",
	openVideoSource: "Ouvrir la source vidéo",
	mediaOpen: "Ouvrir {title}",
	mediaShowEmbed: "Afficher le contenu intégré",

	selectAnAnswer: "Sélectionner une réponse",
	selectAllThatApply: "Sélectionner toutes les réponses applicables",
	selectAMatch: "Sélectionner une correspondance…",
	matchFor: "Correspondance pour : {prompt}",
	selectACategory: "Sélectionner une catégorie…",
	categoryFor: "Catégorie pour : {item}",
	categoryChoiceFor: "{item} : {category}",
	categorizeItemsColumn: "Éléments",
	moveUp: "Déplacer {label} vers le haut",
	moveDown: "Déplacer {label} vers le bas",
	orderItemPosition: "Position {position} sur {total}",
	orderItemMoved: "{label} déplacé à la position {position} sur {total}",
	orderSortableItem: "élément déplaçable",
	selfCheckAnswer: selfCheckStrings.fr.answer,
	selfCheckCheck: selfCheckStrings.fr.check,
	selfCheckShowFeedback: selfCheckStrings.fr.show,
	selfCheckStartOver: selfCheckActivationStrings.fr.selfCheckStartOver,
	selfCheckNeedsScript: "La comparaison de votre réponse avec le modèle nécessite JavaScript.",
	typeYourAnswer: "Saisissez votre réponse…",
	enterANumber: "Entrez un nombre…",
	assessmentEnterResponse: "Entrez une réponse avant de soumettre",
	assessmentReviewReady: "Réponse vérifiée. Consultez les résultats ci-dessus.",
	assessmentQuestion: "Question d'évaluation",
	assessmentWordBank: "Banque de mots : {words}. Utilisez chaque entrée une fois.",
	assessmentBlankLabel: "Blanc {current} sur {total}, après « {context} »",
	assessmentNeedsScript:
		"Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.",
	assessmentPoint: "{points} point",
	assessmentPoints: "{points} points",
	feedbackLabel: "Rétroaction",
	noQuestionText: "Aucun texte de question",
	previewNotAvailable: "Aperçu non disponible pour ce type d'évaluation",
	hotspotLabel: "Zone sensible {index}",
	hotspotSelectionCount: "{selected} zones sélectionnées sur {total}",
	hotspotSelectionPrompt: "{total} zones. Sélectionnez une zone.",
	labeledGraphicClickToReveal: "Sélectionnez les épingles numérotées pour explorer",
	labeledGraphicSequentialInstruction:
		"Explorez les épingles numérotées dans l'ordre. Les épingles suivantes deviennent disponibles après la précédente.",
	labeledGraphicProgress: "{revealed} sur {total} révélés",

	nowShowingBack: "Affichage du verso",
	nowShowingFront: "Affichage du recto",
	flashcardInteraction: "Interaction carte mémo",
	flashcardAriaLabel: "Carte mémo {current} sur {total}, {side}. Cliquer pour retourner",
	turnCard: "J'ai ma réponse",
	backToFront: "Masquer la réponse",
	playCards: "Lire les cartes",
	pauseCards: "Mettre les cartes en pause",
	cardAnnouncement: "Carte {current} sur {total}",

	rateValueOf: "Évaluer {value} sur {count}",
	ratingLabel: "Évaluation",

	slideAnnouncement: "Diapositive {current} sur {total}",
	noSlides: "Aucune diapositive",
	slidesLabel: "Diapositives",
	chooseSlide: "Choisir la diapositive à afficher",
	goToSlide: "Aller à la diapositive {index}",

	signatureLabel: "Signature",
	signatureMethod: "Mode de signature",
	signatureDraw: "Dessiner",
	signatureType: "Taper",
	signatureDrawn: "Signature dessinée",
	signatureMethodLocked: "Effacez votre signature pour changer de mode de signature.",
	drawYourSignature: "Dessinez votre signature",
	signatureKeyboardHint: "Appuyez sur Entrée ou Espace pour saisir votre signature au clavier.",
	signedAt: "Signé le {date}",
	clearSignature: "Effacer",

	untitledGroup: "Groupe sans titre",
	groupModeOneOf: "Un parmi",
	groupModeAll: "Tous",
	groupMember: "membre",
	groupMembers: "membres",
	assessmentGroupResultsSummary: "Résultats",
	assessmentGroupCorrect: "{correct} sur {total} correctes",
	assessmentGroupReview: "Revoir les questions",
	assessmentGroupQuestionReview: "Question {index}\u00a0: {stem}",
	assessmentGroupPassingScore: "Score de réussite : {score} %",
	assessmentGroupProgress: "Questions terminées : {completed} sur {total}",
	assessmentGroupChooseOne: "Choisir une option",
	assessmentGroupSubmitSelected: "Soumettre la sélection",
	assessmentGroupSubmitAll: "Tout soumettre",
	assessmentGroupCheckSelected: "Vérifier la sélection",
	assessmentGroupCheckAll: "Tout vérifier",
	assessmentGroupQuestionFallback: "Question {index}",
	assessmentGroupScore: "Score : {score} %",
	assessmentGroupPassed: "Réussi",
	assessmentGroupNotPassed: "Non réussi",
	assessmentGroupRequiredError: "Répondez à toutes les questions obligatoires avant de soumettre.",
	assessmentGroupSaved: "Réponses enregistrées",

	courseControls: "Commandes du cours",
	courseOutline: "Plan du cours",
	closeCourseOutline: "Fermer le plan",
	collapseSidebar: "Réduire le panneau latéral",
	expandSidebar: "Développer le panneau latéral",

	resourcesHeading: "Ressources",
	resourceDocumentsHeading: "Documents",
	resourceExternalLinksHeading: "Liens externes",
	resourceLessonPdfsHeading: "PDF des leçons",
	resourceCourseDocumentsHeading: "Documents du cours",
	resourceFromLesson: "Tiré de {lesson}",
	untitledResource: "Sans titre",

	interaction: "Interaction",
	columnsPresetBefore: "Avant",
	columnsPresetAfter: "Après",
	columnsPresetOptionA: "Option A",
	columnsPresetOptionB: "Option B",

	lessonLabel: "Leçon {n}",
	narrativeSectionPosition: "Section {current} sur {total}",
	narrativeReadTime: "~{minutes} min",
	a11yPreferences: "Préférences de lecture",
	a11yLargerText: "Texte plus grand",
	a11yLargerTextEnabled: "Texte plus grand activé",
	a11yLargerTextDisabled: "Texte plus grand désactivé",
	a11yFocusReading: "Guide de lecture",
	a11yFocusReadingEnabled: "Guide de lecture activé",
	a11yFocusReadingDisabled: "Guide de lecture désactivé",
};

const catalogs: Record<string, LearnerStrings> = { en, fr };

/** Get learner-facing strings for a locale. Falls back to English. */
export function getStrings(locale: string): LearnerStrings {
	return catalogs[resolveLocale(locale)];
}
// Preview diagnostics are not part of the learner catalog serialized into exports.
interface PreviewStrings {
	errorLine: string;
	invalidSource: string;
	emptyCourse: string;
}
const previewCatalogs: Record<string, PreviewStrings> = {
	en: {
		errorLine: "Error at line {line}",
		invalidSource: "This block contains invalid source.",
		emptyCourse: "Cannot publish a course with no content pages. Add at least one page.",
	},
	fr: {
		errorLine: "Erreur à la ligne {line}",
		invalidSource: "Ce bloc contient une source invalide.",
		emptyCourse: "Impossible de publier un cours sans pages de contenu. Ajoutez au moins une page.",
	},
};
export function getPreviewStrings(locale: string): PreviewStrings {
	return previewCatalogs[resolveLocale(locale)];
}
