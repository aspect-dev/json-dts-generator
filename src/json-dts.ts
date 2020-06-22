import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";
import * as mkdirp from "mkdirp";
import {
  convertToType,
  createCache,
  typeAlias,
  getTypeDeclaration,
  JSONValue,
  TypeDeclaration,
} from "./core";

if (module.parent) {
  throw new Error(
    "This file should be run as a script, not imported as a module.",
  );
}

/**
 * Declaration file which will store declarations from all inputs.
 * Name chosen as such to hopefully avoid collision with an input file.
 **/
const COMMON_FILE = "_common";
const COMMON_DTS = COMMON_FILE + ".d.ts";

const USAGE = "Usage: node json-dts.js INPUT-DIR OUTPUT-DIR";
const INSTRUCTIONS = `
Reads all JSON files inside INPUT-DIR (including those in subdirectories),
parses each into a TS declaration file with matching name and places those
into OUTPUT-DIR, matching the folder structure inside of INPUT-DIR.
`.trim();

const UNKNOWN_ARRAY_WARNING = (declarations: TypeDeclaration[]) => {
  const unfinishedTypeAliases = declarations
    .map(
      ({ id, contexts }) =>
        `  type ${typeAlias(id)}, derived from ${contexts[0]}`,
    )
    .join("\n");

  return `
The proper array type for the following type aliases could not be
inferred because the provided JSON featured empty arrays:

${unfinishedTypeAliases}

These type aliases have been given the type "unknown[]". Opening
${COMMON_DTS} and manually providing the proper types is recommended.
  `.trim();
};

function readJSONSync(file: string): JSONValue {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

if (process.argv.length === 3 && ["-h", "--help"].includes(process.argv[2])) {
  console.log(USAGE + "\n\n" + INSTRUCTIONS);
  process.exit(0);
}

if (process.argv.length !== 4) {
  console.error(USAGE);
  process.exit(1);
}

let cache = createCache();
const inputDir = path.resolve(process.cwd(), process.argv[2]);
const outputDir = path.resolve(process.cwd(), process.argv[3]);

const inputFiles = glob.sync("**/*.json", { cwd: inputDir });
const exportedTypes = new Set<string>();
let currentFile = 1;

console.log("Parsing JSON files...");
for (const file of inputFiles) {
  const json = readJSONSync(path.resolve(inputDir, file));
  const { type: typeName, cache: newCache } = convertToType(cache, json, file);
  exportedTypes.add(typeName);
  cache = newCache;

  mkdirp.sync(path.resolve(outputDir, path.dirname(file)));
  const outputFile = path.resolve(outputDir, file.replace(".json", ".d.ts"));
  const relativePath = path.relative(path.dirname(outputFile), outputDir);
  const relativeImport = relativePath
    ? path.join(relativePath, COMMON_FILE)
    : "./" + COMMON_FILE;

  fs.writeFileSync(
    outputFile,
    `export { ${typeName} as default } from "${relativeImport}";`,
  );

  console.log(`Finished file ${currentFile} of ${inputFiles.length}: ${file}`);
  currentFile += 1;
}

console.log(`Creating ${COMMON_DTS} file...`);
const output = fs.createWriteStream(path.resolve(outputDir, COMMON_DTS));

output.write(
  `
/**
 * Compute utility which makes resulting types easier to read
 * with IntelliSense by expanding them fully, instead of leaving
 * object properties with cryptic type names.
 */
type C<A extends any> = {[K in keyof A]: A[K]} & {};
`.trim(),
);
output.write("\n\n");

const unknownArrays: TypeDeclaration[] = [];
for (const declaration of cache.map.values()) {
  if (declaration.type === "unknown[]") {
    unknownArrays.push(declaration);
  }

  const typeDeclaration = getTypeDeclaration(declaration);
  if (exportedTypes.has(typeAlias(declaration.id))) {
    output.write("export ");
  }

  output.write(typeDeclaration);
  output.write(" // ");
  for (let i = 0; i < declaration.contexts.length; i++) {
    const context = declaration.contexts[i];
    output.write(context);
    if (i < declaration.contexts.length - 1) {
      output.write(", ");
    }
  }
  output.write("\n");
}

output.close();
console.log(COMMON_DTS + " created successfully.");

if (unknownArrays.length) {
  console.log("\n" + UNKNOWN_ARRAY_WARNING(unknownArrays));
}
