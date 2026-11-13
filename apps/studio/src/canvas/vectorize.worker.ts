import { vectorizeAtWorkingResolution } from "@indoor/vectorize";
import type { AnalysisRequest, AnalysisResponse } from "./referenceAnalysis";

/**
 * Runs the CV vectorization pass off the main thread. One request in, one
 * response out, tagged with the caller's job id so stale replies can be
 * ignored. Cancellation is done by the caller terminating this worker.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage(message: AnalysisResponse): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  try {
    const result = vectorizeAtWorkingResolution(
      {
        image: {
          data: new Uint8ClampedArray(request.pixels),
          width: request.width,
          height: request.height,
        },
        transform: request.transform,
        scaleX: request.scaleX,
        scaleY: request.scaleY,
        sourceWidth: request.sourceWidth,
        sourceHeight: request.sourceHeight,
      },
      request.options,
    );
    scope.postMessage({ jobId: request.jobId, ok: true, result });
  } catch (error) {
    scope.postMessage({
      jobId: request.jobId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
