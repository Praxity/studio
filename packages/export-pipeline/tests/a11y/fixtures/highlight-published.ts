import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { persistFixtureIdentity } from "../../../../../apps/desktop/src/test-utils/identity-fixture";

const checkout = fileURLToPath(new URL("../../../../../", import.meta.url));
export const highlightXapi = {
	endpoint: "https://lrs.example/statements",
	auth: "proof",
	actorMode: "lms" as const,
};

/** Build the production CLI once per spec. xAPI has no CLI flag, so use its
 * existing source-input and deployment owners with the same saved course. */
export async function highlightPublisher(
	directory: string,
	preparedAssets = join(checkout, "apps/desktop/resources/export-assets"),
) {
	const assets = join(directory, "assets");
	// Each file keeps a captured asset set while other checks may rebuild the checkout.
	await cp(preparedAssets, assets, { recursive: true });
	const runtimeRequire = createRequire(join(checkout, "packages/shared-blocks/package.json"));
	const entry = join(directory, "cli.mjs");
	await build({
		stdin: {
			resolveDir: checkout,
			contents: `
import {readFile,writeFile} from 'node:fs/promises';
import AdmZip from ${JSON.stringify(createRequire(join(checkout, "packages/export-pipeline/package.json")).resolve("adm-zip"))};
import {runPraxityCli} from './apps/desktop/src/main/cli';
import {buildCourseExportInput} from './apps/desktop/src/main/export/build-export-input-from-project';
import {compileCourse,deployCourse} from './packages/export-pipeline/src/build';
const [project,format,output]=process.argv.slice(2);
async function publish() {
 if(format !== 'xapi' && format !== 'preview') {
  const result=await runPraxityCli(['export',project,'--format',format,'--output',output],{appVersion:'0.3.0',exportAssetsDir:${JSON.stringify(assets)}});
  if(result.exitCode) throw new Error(result.stderr+result.stdout);
  return result;
 }
 const input=await buildCourseExportInput({projectDir:project,scope:'course',manifestPolicy:'read-only',completionThreshold:0.8,viewerVersionPath:${JSON.stringify(join(assets, "viewer.version.json"))},inheritWorkspaceSettings:false});
 const compiled=await compileCourse(input,{mode:'desktop',prebuiltAssetsDir:${JSON.stringify(assets)},projectDir:project});
 try {
 if(format === 'preview') {
  const deployment=await deployCourse(compiled,{format:'standalone'});
  try {
   const zip=new AdmZip();
   for(const file of deployment.manifest.files) {
    const chunks=[]; for await(const chunk of await deployment.openFile(file.path)) chunks.push(Buffer.from(chunk));
    zip.addFile(file.path,Buffer.concat(chunks));
   }
   await writeFile(output,zip.toBuffer());
   await writeFile(output+'.manifest.json',JSON.stringify(deployment.manifest,null,2));
   return {exitCode:0,stdout:'Captured standalone preview deployment',stderr:''};
  } finally {await deployment.dispose();}
 }
 const result=await deployCourse(compiled,{format:'xapi',xapiConfig:${JSON.stringify(highlightXapi)}});await writeFile(output,result.zip); return {exitCode:0,stdout:'xAPI deployment API',stderr:''}; } finally {await compiled.dispose();}
}
const receipt=await publish();process.stdout.write(JSON.stringify(receipt));`,
		},
		outfile: entry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: `import {createRequire as createBundleRequire} from 'node:module'; const require=createBundleRequire(${JSON.stringify(pathToFileURL(join(checkout, "package.json")).href)});`,
		},
		plugins: [
			{
				name: "external-dom-runtime",
				setup(builder) {
					builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
						path: pathToFileURL(runtimeRequire.resolve(args.path)).href,
						external: true,
					}));
				},
			},
		],
	});

	return async (
		name: string,
		source: string | Record<string, string>,
		formats: readonly string[],
		deck = false,
		manifest = "",
	) => {
		const project = join(directory, name);
		await mkdir(project, { recursive: true });
		await writeFile(
			join(project, "course.yaml"),
			`title: Highlight publication\nlessons: [${typeof source === "string" ? "lesson.prax" : Object.keys(source).join(", ")}]\n${deck ? "moduleDeck: true\n" : ""}${manifest}`,
		);
		for (const [file, text] of Object.entries(
			typeof source === "string" ? { "lesson.prax": source } : source,
		))
			await writeFile(join(project, file), text);
		await persistFixtureIdentity(project);
		const result = new Map<string, AdmZip>();
		for (const format of formats) {
			const output = join(directory, `${name}-${format}.zip`);
			const receipt = await promisify(execFile)(process.execPath, [entry, project, format, output]);
			await writeFile(join(directory, `${name}-${format}-cli.json`), JSON.stringify(receipt));
			result.set(format, new AdmZip(await readFile(output)));
		}
		return result;
	};
}
