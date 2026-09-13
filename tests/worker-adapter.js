import {Worker} from 'node:worker_threads';

// Exercise the actual browser worker module on a real thread in Node.
export class BrowserWorker {
  constructor(url) {
    this.worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      globalThis.self={postMessage:data=>parentPort.postMessage(data)};
      const ready=import(workerData.url);
      parentPort.on('message',async data=>{await ready;await self.onmessage({data});});
    `, {eval:true, workerData:{url: url.href}});
    this.worker.on('message',data=>this.onmessage?.({data}));
    this.worker.on('error',error=>this.onerror?.({message:error.message}));
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { this.terminated = true; return this.worker.terminate(); }
}
