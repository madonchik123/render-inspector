import {parseCapture, LIMITS} from './model.js';

export async function readCapture(file, progress = () => {}) {
  if (file.size > LIMITS.bytes) {
    throw Error(`This file is ${(file.size / 1048576).toFixed(1)} MiB. Split captures larger than 128 MiB to fit browser memory.`);
  }
  progress('Reading file');
  const text = await file.text();
  progress('Parsing and checking draw calls');
  const data = parseCapture(text);
  progress(`Preparing ${data.calls.length.toLocaleString()} calls`);
  return data;
}

if (typeof self !== 'undefined') {
  self.onmessage = async ({data: file}) => {
    try {
      const data = await readCapture(file, message => self.postMessage({progress: message}));
      self.postMessage({data});
    } catch (error) {
      self.postMessage({error: error.message || 'The browser could not read this capture. Try a smaller file.'});
    }
  };
}
