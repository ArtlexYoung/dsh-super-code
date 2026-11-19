import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { WorkbenchFiles } from '../../../../src/workbench/files.ts';
import { validationRoot } from '../../../validation-root.ts';

const repo=fileURLToPath(new URL('../../../../',import.meta.url));
await mkdir(validationRoot,{recursive:true});
const root=await mkdtemp(join(validationRoot,'browser-index-')),ctx=new Context();
await ctx.plugin(LocalFileSystem,{cwd:root});
const createFiles=()=>new WorkbenchFiles(ctx.fs,async()=>({cwd:root}));
let files=createFiles(),reads=[];
const texts={'main.ts':"import {run} from './right';\nrun(1);",'right.ts':'/** 计算值。 */\nexport function run(value: number) {return value+1;}', 'other.ts':'export const unrelated = "source-body-private";'};
for(const[path,text]of Object.entries(texts))await writeFile(join(root,path),text);
const fixture=`import{createWorkbench}from'./builtin/workbench/controller.js';import{analyze}from'./builtin/workbench/analysis/index.js';
let calls=0;const api={list:async()=>({entries:[],truncated:false}),fileOperation:async()=>({path:'/demo'}),project:async signal=>(await fetch('/project',{signal})).json(),
read:async(path,signal)=>(await fetch('/read?path='+encodeURIComponent(path),{signal})).json(),
storeIndex:async(entries,signal)=>(await fetch('/store',{method:'POST',body:JSON.stringify(entries),signal})).json()};
const c=createWorkbench(api,k=>k);const original=c.index.analyzer;c.index.analyzer=(...args)=>{calls++;return original(...args)};
window.test={c,calls:()=>calls,ready:c.attach(document.getElementById('editor'),document.body),dispose:()=>c.dispose()};`;
const worker=await build({entryPoints:[join(repo,'builtin/workbench/analysis/worker.js')],bundle:true,write:false,format:'iife',platform:'browser'});
const app=await build({stdin:{contents:fixture,resolveDir:repo,loader:'js'},bundle:true,write:false,format:'esm',platform:'browser',define:{__WORKBENCH_ANALYSIS_WORKER__:JSON.stringify(worker.outputFiles[0].text)}});
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');res.setHeader('content-type','application/json');
    if(url.pathname==='/project')res.end(JSON.stringify(await files.project('demo')));
    else if(url.pathname==='/read'){const path=url.searchParams.get('path');reads.push(path);res.end(JSON.stringify(await files.read('demo',path)))}
    else if(url.pathname==='/store'){const chunks=[];for await(const chunk of req)chunks.push(chunk);res.end(JSON.stringify(await files.storeIndex('demo',JSON.parse(Buffer.concat(chunks).toString()),new AbortController().signal)))}
    else if(url.pathname==='/app.js'){res.setHeader('content-type','text/javascript');res.end(app.outputFiles[0].contents)}
    else{res.setHeader('content-type','text/html');res.end('<!doctype html><div id="editor" style="height:600px"></div><script type="module" src="/app.js"></script>')}
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await(process.env.SC_TEST_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
try{
  await test('实际 Worker 和磁盘缓存：冷启跳过解析、增量刷新与按需跳转',async()=>{
    const errors=[];
    async function open(){const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.test?.c.snapshot().indexed===3&&!window.test.c.snapshot().indexing);return page}
    let page=await open();assert.equal(reads.length,3);assert.equal(await page.evaluate(()=>window.test.calls()),3);
    const cache=join(root,'.dsh-super-code/index/workbench-v1.json'),content=await readFile(cache,'utf8');
    assert.doesNotMatch(content,/source-body-private|计算值|return value/);
    await page.evaluate(()=>window.test.dispose());await page.close();files=createFiles();reads=[];
    page=await open();assert.deepEqual(reads,[]);assert.equal(await page.evaluate(()=>window.test.calls()),0);
    assert.equal(await page.evaluate(()=>window.test.c.index.candidates('main.ts','run').length),1);
    const stamp=(await stat(cache)).mtimeMs;await page.evaluate(()=>window.test.c.refresh());assert.equal((await stat(cache)).mtimeMs,stamp);
    await writeFile(join(root,'right.ts'),'/** 新说明。 */\nexport function replacement(value: number) {return value}');reads=[];
    await page.evaluate(()=>window.test.c.refresh());assert.deepEqual(reads,['right.ts']);assert.equal(await page.evaluate(()=>window.test.calls()),1);
    assert.equal(await page.evaluate(()=>window.test.c.index.candidates('main.ts','run').length),0);
    assert.equal(await page.evaluate(()=>window.test.c.index.candidates('main.ts','replacement').length),1);
    const described=await page.evaluate(()=>window.test.c.index.describe(window.test.c.index.candidates('main.ts','replacement')));
    assert.match(described[0].documentation.description,/新说明/);
    await page.evaluate(()=>window.test.dispose());await page.close();assert.deepEqual(errors,[]);
  });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
