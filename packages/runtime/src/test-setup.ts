// jsdom doesn't implement canvas rendering; stub getContext to return null
// quietly instead of logging "Not implemented" for every IndoorRuntime
// constructed in tests. IndoorRuntime already treats a null context as
// "skip drawing," so this changes nothing about what's under test.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}
