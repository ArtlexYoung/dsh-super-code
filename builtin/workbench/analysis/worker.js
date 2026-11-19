import { analyze } from './index.js';

self.onmessage = async ({ data: { id, file, text, detail } }) => {
  try { self.postMessage({ id, value: await analyze(file, text, detail) }); }
  catch (error) { self.postMessage({ id, error: error.message }); }
};
