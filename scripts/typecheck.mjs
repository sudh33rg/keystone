import ts from 'typescript';
import path from 'node:path';
const args=new Set(process.argv.slice(2));
const configs=args.has('--extension-only')?['tsconfig.json']:args.has('--webview-only')?['tsconfig.webview.json']:['tsconfig.json','tsconfig.webview.json'];
let errors=0;
for(const configFile of configs){const absolute=path.resolve(configFile);const read=ts.readConfigFile(absolute,ts.sys.readFile);if(read.error){print(read.error);errors++;continue;}const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,path.dirname(absolute),undefined,absolute);const program=ts.createProgram({rootNames:parsed.fileNames,options:parsed.options,projectReferences:parsed.projectReferences});const diagnostics=ts.getPreEmitDiagnostics(program);for(const d of diagnostics)print(d);errors+=diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length;console.log(`${configFile}: ${parsed.fileNames.length} files, ${diagnostics.length} diagnostic(s).`);}
if(errors)process.exit(1);
function print(d){const text=ts.flattenDiagnosticMessageText(d.messageText,'\n');if(d.file&&d.start!==undefined){const pos=d.file.getLineAndCharacterOfPosition(d.start);console.error(`${path.relative(process.cwd(),d.file.fileName)}:${pos.line+1}:${pos.character+1} TS${d.code}: ${text}`);}else console.error(`TS${d.code}: ${text}`);}
