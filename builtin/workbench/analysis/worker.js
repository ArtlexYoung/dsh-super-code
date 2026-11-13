import { analyze } from './index.js';

self.onmessage = async ({ data: { id, file, text } }) => {
  try { self.postMessage({ id, value: await analyze(file, text) }); }
  catch (error) { self.postMessage({ id, error: error.message }); }
};
