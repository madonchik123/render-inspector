export function importCapture(file, {signal, progress = () => {}} = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.js', import.meta.url), {type: 'module'});
    const finish = (error, data) => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(data);
    };
    const abort = () => finish(new DOMException('Import cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) return abort();
    worker.onmessage = ({data}) => {
      if (data.progress) progress(data.progress);
      else if (data.error) finish(new Error(data.error));
      else finish(null, data.data);
    };
    worker.onerror = event => finish(new Error(event.message || 'Import could not finish. Try reopening the file or using a smaller capture.'));
    try { worker.postMessage(file); } catch (error) { finish(error); }
  });
}
