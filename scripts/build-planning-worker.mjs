import ts from 'typescript';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
const out=new URL('../public/planning-worker/',import.meta.url);await mkdir(out,{recursive:true});
for(const name of ['routing','pedestrian-world','pedestrian-geometry','comfort','solar-shade','route-shade','walking','walking-geometry','verification','path-anchors','report-status','place-details','route-conditions','journeys','errand-planner','place-goals','maintenance-impact','walk-tools','planning-dispatch','planning-entry']){
    const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
    const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,verbatimModuleSyntax:true}});
    const code=result.outputText.replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g,'$1.js$2');
    await writeFile(new URL(`${name}.js`,out),code);
}
console.log('The pedestrian planning worker is ready. It runs locally and makes no network requests.');
