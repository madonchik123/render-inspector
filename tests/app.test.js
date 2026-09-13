import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BrowserWorker} from './worker-adapter.js';

test('viewer opens example, selects groups and exports through its controls',async()=>{
 const elements=new Map(),raf=[],events={};let clipboard='';
 const context=new Proxy({createLinearGradient:()=>({addColorStop(){}})}, {get:(obj,key)=>obj[key]||(()=>{}),set:(obj,key,value)=>(obj[key]=value,true)});
 class Element {
  constructor(id='',tag='DIV'){this.id=id;this.tagName=tag;this.children=[];this.value='';this.style={};this.hidden=false;this.checked=['scale-code','context-code'].includes(id);this.open=false;this.clientWidth=1000;this.clientHeight=700;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}
  append(...children){this.children.push(...children);if(this.id==='frame'&&!this.value&&children[0])this.value=children[0].value;}
  replaceChildren(...children){this.children=[];this.value='';this.append(...children);}
  setAttribute(){}getContext(){return context;}getBoundingClientRect(){return {left:0,top:0,width:parseFloat(this.style.width)||1000,height:parseFloat(this.style.height)||700};}
  showModal(){this.open=true;}close(){this.open=false;}focus(){}select(){}contains(){return false;}setPointerCapture(){}click(){this.onclick?.({});}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 globalThis.document={getElementById:get,createElement:tag=>new Element('',tag),createTextNode:text=>({textContent:text}),addEventListener:(event,fn)=>events[event]=fn,activeElement:{tagName:'BODY'}};
 globalThis.Option=class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}};
 globalThis.ResizeObserver=class{observe(){}};globalThis.requestAnimationFrame=fn=>raf.push(fn);globalThis.devicePixelRatio=1;globalThis.innerWidth=1600;globalThis.innerHeight=1000;
 globalThis.setTimeout=()=>1;globalThis.clearTimeout=()=>{};
 globalThis.Worker=BrowserWorker;
 Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async text=>{clipboard=text;}}},configurable:true});
 await import('../app.js');
 get('example').click();while(raf.length)raf.shift()();
 assert.equal(get('welcome').hidden,true);assert(get('layers').children.length>10);assert(get('filename').textContent.includes('synthetic'));
 get('helpers-tab').click();assert.equal(get('layers').children.length,1);get('layers').children[0].onclick({ctrlKey:false,metaKey:false});get('export').click();
 assert(get('export-dialog').open);assert(get('code').value.includes('Render.FilledRect'));assert(get('code').value.includes('Render.PushClip'));
 await get('copy-code').onclick();assert.equal(clipboard,get('code').value);get('close-export').click();get('select-panel').click();
 get('width').value=2560;get('height').value=1440;get('resolution').click();while(raf.length)raf.shift()();assert(get('canvas').width>0);
 get('hide').click();assert.equal(get('restore').hidden,false);get('restore').click();
 await get('file').onchange({target:{files:[new File(['{oops'],'broken.json')]}});
 assert(get('notice').classes.has('error'));assert(get('notice').textContent.includes('valid JSON'));
 const {exampleCapture}=await import('../example.js');
 await get('file').onchange({target:{files:[new File([JSON.stringify(exampleCapture())],'uploaded.json')]}});
 assert.equal(get('filename').textContent,'uploaded.json');assert.equal(get('file').value,'');
 assert(!get('notice').classes.has('error'));assert(get('notice').textContent.includes('Opened'));
});
