/** One recovery message for CLI and canvas. Commands dereference links, including hidden children. */
export function projectPlainStoreMessage(path: string, locale: "en" | "fr"): string {
	const backup = ".praxity-linked-backup";
	const copy = ".praxity-plain-copy";
	const shell = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
	const powershell = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const commands = `macOS / Linux Terminal:\ncp -R -L ${shell(path)} ${shell(copy)}\nmv ${shell(path)} ${shell(backup)}\nmv ${shell(copy)} ${shell(path)}\nWindows PowerShell:\nCopy-Item -LiteralPath ${powershell(path)} -Destination ${powershell(copy)} -Recurse -ErrorAction Stop\nMove-Item -LiteralPath ${powershell(path)} -Destination ${powershell(backup)} -ErrorAction Stop\nMove-Item -LiteralPath ${powershell(copy)} -Destination ${powershell(path)} -ErrorAction Stop`;
	return locale === "fr"
		? `Studio a besoin d'une copie ordinaire de ${path}. Les liens, les fichiers spéciaux, les fichiers avec plusieurs liens physiques et les chemins sur un autre volume ne peuvent pas stocker les identités.\n1. Fermez Studio. Ouvrez le Terminal ou PowerShell dans le dossier du projet.\n2. Vérifiez que ${backup} et ${copy} n'existent pas. Sinon, choisissez des noms inutilisés dans les commandes.\n3. Exécutez les trois commandes de votre plateforme dans l'ordre. Arrêtez-vous si une commande échoue. Elles copient le contenu, déplacent le chemin lié hors du stockage des identités, puis donnent à la copie le nom original.\n${commands}\n4. Conservez ${backup} et sa cible. Rouvrez Studio.`
		: `Studio needs a plain copy of ${path}. Links, special files, hard-linked files and paths on another volume cannot store identity.\n1. Close Studio. Open Terminal or PowerShell in the project folder.\n2. Check that ${backup} and ${copy} do not exist. Otherwise, choose unused names in the commands.\n3. Run the three commands for your platform in order. Stop if any command fails. They copy the contents, move the linked path out of identity storage, then give the copy the original name.\n${commands}\n4. Keep ${backup} and its target. Reopen Studio.`;
}

export function projectPlainStorePath(error: unknown): string | undefined {
	const ref = (error as { messageRef?: { key?: unknown; args?: { path?: unknown } } } | null)
		?.messageRef;
	return ref?.key === "desktop.identity.plainStoreRequired" && typeof ref.args?.path === "string"
		? ref.args.path
		: undefined;
}

/** Shared by I4 admission and T1 planning without importing identity formats into T1. */
export class ProjectPlainStoreError extends Error {
	readonly code = "EIDENTITY";
	readonly messageRef;
	constructor(path: string) {
		super(projectPlainStoreMessage(path, "en"));
		this.messageRef = { key: "desktop.identity.plainStoreRequired" as const, args: { path } };
	}
}

/** The recovery steps also apply when the only remaining identity is in a T1 archive. */
export function projectIdentityRecoveryMessage(locale: "en" | "fr"): string {
	return locale === "fr"
		? "Studio ne trouve pas .praxity/identity/course.json pour un cours existant. Pour conserver les identifiants des blocs, restaurez les fichiers manquants ou corrompus. Restaurez le dossier complet .praxity/identity/ depuis une sauvegarde, puis rouvrez le cours. Les dossiers .praxity-write-* peuvent contenir des copies : utilisez praxity recovery list <project-dir>, puis praxity recovery extract <project-dir> <archive> <new-directory> pour les examiner et les conserver. Pour chaque fichier choisi, utilisez praxity recovery restore <project-dir> <archive> original <path> pour restaurer la copie originale, ou remplacez original par replacement pour la copie de remplacement. La restauration conserve l'archive et sauvegarde les octets remplacés. Une archive peut ne pas contenir tous les fichiers nécessaires. Les fichiers existants dans .praxity/review sont conserv\u00e9s ; les modifications n'en \u00e9crivent plus. Si narration.yaml, .praxity/review ou .praxity/content-identity.json existe sans course.json, restaurez aussi les fichiers d'identité correspondants. Supprimer une archive avec praxity recovery resolve <project-dir> <archive> ne restaure aucun fichier et ne supprime pas ces obstacles. Nouvelle identité volontaire : copiez course.yaml, les sources .prax et les ressources dans un nouveau dossier, sans .praxity/, narration.yaml ni les dossiers .praxity-write-*. Les identifiants des blocs seront nouveaux. Conservez le dossier original. Dans le dossier original, n'utilisez resolve qu'après restauration ou si aucune identité conservée n'est nécessaire. Réessayer sans fichiers d'identité ni obstacles crée de nouveaux identifiants de blocs."
		: "Identity: missing .praxity/identity/course.json for an established course. To keep block IDs, restore the missing or corrupt files. Restore the complete .praxity/identity/ folder from a backup, then reopen. Retained .praxity-write-* folders may contain copies: use praxity recovery list <project-dir>, then praxity recovery extract <project-dir> <archive> <new-directory> to inspect and preserve them. For each chosen file, use praxity recovery restore <project-dir> <archive> original <path> to restore its original copy, or replace original with replacement for its replacement copy. Restore keeps the archive and backs up displaced bytes. An archive may not contain every required file. Existing .praxity/review evidence is kept; edits no longer write it. If narration.yaml, .praxity/review or .praxity/content-identity.json exists without course.json, restore the corresponding identity files too. Removing an archive with praxity recovery resolve <project-dir> <archive> restores no files and does not clear those fences. Deliberate new identity: copy course.yaml, .prax sources and assets into a new folder without .praxity/, narration.yaml or .praxity-write-* folders. Block IDs will be new. Keep the original folder. In the original folder, use resolve only after restoration or when no retained identity is needed. Retrying without identity files or fences creates new block IDs.";
}

export function projectIdentityRecoveryAdvice(
	error: unknown,
	locale: "en" | "fr",
): string | undefined {
	const seen = new Set<unknown>();
	while (error && !seen.has(error)) {
		seen.add(error);
		if ((error as { code?: unknown }).code === "EIDENTITY_CANONICAL_VERSION")
			return locale === "fr"
				? "Ce stockage d'identité utilise la version canonique 2. Ouvrez-le avec une version de Studio qui prend en charge la correspondance de version 2. Conservez les fichiers d'identité. Aucun fichier modifié."
				: "This identity store uses canonical version 2. Open it with a Studio version that supports version-2 matching. Keep the identity files. No files changed.";
		const ref = (error as { messageRef?: { key?: unknown } }).messageRef;
		if (ref?.key === "desktop.identity.missingEstablished")
			return projectIdentityRecoveryMessage(locale);
		error = error instanceof Error ? error.cause : undefined;
	}
	return undefined;
}

export class PlainYamlRequiredError extends Error {
	readonly code = "EPLAINYAML";
	constructor(cause?: unknown) {
		super(
			"Plain YAML required: this legacy edit cannot preserve this file exactly. Use a single mapping document without anchors, aliases, flow comments or trailing commas. No files were changed.",
			{ cause },
		);
	}
}

export class ProjectFileBusyError extends Error {
	readonly code = "EFILEBUSY";
	constructor(cause: unknown) {
		super("File is in use by another program. Try saving again.", { cause });
	}
}

/** Electron can preserve only the message across invoke. */
export function isProjectFileBusyError(error: unknown): boolean {
	return (
		(error as { code?: string } | null)?.code === "EFILEBUSY" ||
		/file is in use by another program/i.test(String(error))
	);
}

export function projectPermissionMessage(locale: "en" | "fr"): string {
	return locale === "fr"
		? "Studio ne peut pas enregistrer lorsque le modèle de permissions de Node est activé, car il bloque la synchronisation des fichiers qui protège les enregistrements. Relancez sans --permission."
		: "Studio can't save while Node's permission model is on, because it blocks the file sync that keeps saves safe. Run without --permission.";
}

export class ProjectPermissionError extends Error {
	readonly name = "ProjectPermissionError";
	readonly code = "EPERMISSIONMODEL";
	constructor() {
		super(projectPermissionMessage("en"));
	}
}

export class ProjectBusyError extends Error {
	readonly code = "EPROJECTBUSY";
	constructor() {
		super("Project is busy in another Studio window or process. Try again.");
	}
}

/** An unlocked read must restart after the first writer creates its lock database. */
export class ProjectReadAdmissionChangedError extends ProjectBusyError {}

export class ProjectFilesystemUnsupportedError extends Error {
	readonly code = "EPROJECTFILESYSTEM";
	constructor(cause: unknown) {
		super(
			"This project folder cannot create hard links. Move the project to a filesystem that supports hard links.",
			{ cause },
		);
	}
}

export class ProjectRecoveryRequiredError extends Error {
	readonly code = "ERECOVERYREQUIRED";
	constructor() {
		super(
			'Project recovery required. A save or the next write will recover the interrupted transaction. Reopen the course in Studio or run praxity recovery run "<project-dir>" with this course folder. Read-only access leaves every file unchanged.',
		);
	}
}

/** Electron invoke preserves the message, but can omit custom error properties. */
export function isProjectBusyError(error: unknown): boolean {
	return (
		(error as { code?: string } | null)?.code === "EPROJECTBUSY" ||
		/project is busy in another Studio window or process/i.test(String(error))
	);
}

export class ProjectLockCacheOverlapError extends Error {
	readonly code = "ELOCKCACHE";
	constructor() {
		super(
			"Project paths must stay outside the private lock cache. Choose a separate project folder.",
		);
	}
}

export function projectReadErrorKey(
	error: unknown,
):
	| "projectBusy"
	| "projectReadError"
	| "privateLockCache"
	| "fileBusy"
	| "projectRecoveryConflict"
	| "projectRecoveryRequired"
	| "projectFilesystemUnsupported"
	| "plainStoreRequired"
	| "plainYamlRequired" {
	if (projectPlainStorePath(error) !== undefined) return "plainStoreRequired";
	if (
		(error as { code?: string } | null)?.code === "EPROJECTFILESYSTEM" ||
		/project folder cannot create hard links/i.test(String(error))
	)
		return "projectFilesystemUnsupported";
	if (
		(error as { code?: string } | null)?.code === "ERECOVERYREQUIRED" ||
		/Project recovery required/i.test(String(error))
	)
		return "projectRecoveryRequired";
	if (
		(error as { code?: string } | null)?.code === "EPLAINYAML" ||
		/Plain YAML required/i.test(String(error))
	)
		return "plainYamlRequired";
	if (
		(error as { code?: string } | null)?.code === "EPROJECTRECOVERY" ||
		/project (?:recovery|rollback) conflict|recovery copies retained/i.test(String(error))
	)
		return "projectRecoveryConflict";
	if (
		(error as { code?: string } | null)?.code === "ELOCKCACHE" ||
		/private lock cache/i.test(String(error))
	)
		return "privateLockCache";
	if (isProjectFileBusyError(error)) return "fileBusy";
	return isProjectBusyError(error) ? "projectBusy" : "projectReadError";
}

/** Refused writes reject. A returned result acknowledges the committed bytes. */
export interface ProjectWriteResult {
	cleanupError?: string;
}

export class NarrationTargetUnresolvedError extends Error {
	readonly code = "narration_target_unresolved";
	constructor(readonly source: string) {
		super("Invalid narration.yaml v2: target identity or role");
	}
}

export function narrationTargetUnresolvedMessage(locale: "en" | "fr"): string {
	return locale === "fr"
		? "Corrigez le bloc avant de modifier sa narration. Le texte de votre script est conservé."
		: "Fix the block before editing its narration. Your script text is kept.";
}
