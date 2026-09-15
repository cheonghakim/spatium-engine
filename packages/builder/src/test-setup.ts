// jsdom doesn't implement canvas rendering; IndoorBuilder wraps an
// IndoorRuntime, which creates a canvas — stub getContext to return null
// quietly instead of logging "Not implemented" for every test.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}
