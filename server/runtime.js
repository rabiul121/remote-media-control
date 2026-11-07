// What the server remembers between requests: which window each page controls, and slow-to-detect facts.
module.exports = {
  defaultWindow: 0,
  explorerWindow: 0,
  browserWindow: 0,
  browsers: null, // installed browsers, re-detected every few minutes
  defaultBrowser: "",
  browsersCheckedAt: 0,
};
