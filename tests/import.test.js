import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importCapture} from '../import.js';
import {parseCapture, buildFrame, indexFrames} from '../model.js';
import {BrowserWorker} from './worker-adapter.js';

globalThis.Worker = BrowserWorker;
const capture = calls => ({version:2,screen:{width:1920,height:1080},sources:['example.lua:1'],calls});
const rect = (id, frame = 1) => ({id,frame,method:'FilledRect',args:[{kind:'Vec2',x:10,y:10},{kind:'Vec2',x:100,y:60},{kind:'Color',r:255,g:255,b:255,a:255}]});

test('imports metadata-heavy captures beyond the old 500,000-value limit without losing data', async () => {
  const calls = Array.from({length:1200},(_,i)=>({...rect(i+1,Math.floor(i/40)),results:[{kind:'table',entries:Array.from({length:100},(_,j)=>({key:j+1,value:{kind:'Vec2',x:j,y:j}}))}]}));
  const text = JSON.stringify(capture(calls));
  const progress = [];
  const data = await importCapture(new File([text],'large.json'),{progress:p=>progress.push(p)});
  assert.equal(data.calls.length,1200);
  assert.deepEqual(data.calls.at(-1).results,calls.at(-1).results);
  assert.equal(buildFrame(data,0).parts.length,40);
  assert.equal(indexFrames(data).size,30);
  assert(progress.some(p=>p.includes('Parsing')));
});

test('more than 30,000 calls and deep opaque metadata do not block valid frames', () => {
  const data = capture(Array.from({length:31000},(_,i)=>rect(i+1,Math.floor(i/100))));
  let nested = {text:'preserved'};
  for(let i=0;i<80;i++)nested={nested};
  data.metadata=nested;
  const parsed=parseCapture(JSON.stringify(data));
  assert.equal(parsed.calls.length,31000);
  assert.deepEqual(parsed.metadata,nested);
  assert.equal(buildFrame(parsed,309).parts.length,100);
});

test('worker reports malformed JSON and a specific oversized-file message', async () => {
  await assert.rejects(importCapture(new File(['{broken'],'bad.json')),/not valid JSON/);
  const {readCapture}=await import('../import-worker.js');
  await assert.rejects(readCapture({size:129*1048576,text:()=>assert.fail('must not read oversized file')}),/129.0 MiB/);
});

test('cancelling an import terminates its worker', async () => {
  let latest;
  globalThis.Worker=class extends BrowserWorker {constructor(url){super(url);latest=this;}};
  try {
    const controller=new AbortController();
    const pending=importCapture(new File([JSON.stringify(capture([rect(1)]))],'cancel.json'),{signal:controller.signal});
    controller.abort();
    await assert.rejects(pending,{name:'AbortError'});
    assert(latest.terminated);
  } finally {globalThis.Worker=BrowserWorker;}
});
