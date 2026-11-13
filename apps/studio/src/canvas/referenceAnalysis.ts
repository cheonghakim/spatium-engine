import {
  planAnalysisResolution,
  sampleAffineTransform,
  vectorizeAtWorkingResolution,
  type AffinePixelTransform,
  type VectorizationResult,
  type VectorizeOptions,
} from "@indoor/vectorize";
import type { ReferenceManager } from "@indoor/editor";
import { getLoadedImage } from "./imageCache";

/** Main thread -> worker. `pixels` is a transferred RGBA buffer at working resolution. */
export interface AnalysisRequest {
  jobId: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  scaleX: number;
  scaleY: number;
  /** Reference calibration in source-image pixels. */
  transform: AffinePixelTransform;
  options: VectorizeOptions;
}

export type AnalysisResponse =
  | { jobId: number; ok: true; result: VectorizationResult }
  | { jobId: number; ok: false; message: string };

/** Failure with a message meant to be shown to the user as-is. */
export class AnalysisError extends Error {}
/** The job was cancelled (or superseded); callers should restore UI silently. */
export class AnalysisCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

export interface AnalysisJob {
  jobId: number;
  promise: Promise<VectorizationResult>;
  /** Stops the job: terminates the worker if it is running there. Safe to call repeatedly. */
  cancel(): void;
}

const FAILURE_MESSAGE = "도면 분석에 실패했습니다. 다른 이미지로 다시 시도하세요.";

interface Pending {
  resolve(result: VectorizationResult): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextJobId = 1;
const pending = new Map<number, Pending>();

function rejectAll(error: () => Error): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) entry.reject(error());
}

function terminateWorker(): void {
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./vectorize.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerUnavailable = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
    const response = event.data;
    const entry = pending.get(response.jobId);
    if (!entry) return; // stale reply for a cancelled/superseded job
    pending.delete(response.jobId);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new AnalysisError(`${FAILURE_MESSAGE} (${response.message})`));
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    // A worker-level error (script failed to load, uncaught crash, out of memory)
    // leaves it unusable: drop it and fail every waiting job visibly.
    terminateWorker();
    const detail = event.message ? ` (${event.message})` : "";
    rejectAll(() => new AnalysisError(`${FAILURE_MESSAGE}${detail}`));
  };
  worker.onmessageerror = () => {
    terminateWorker();
    rejectAll(() => new AnalysisError(FAILURE_MESSAGE));
  };
  return worker;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Starts analysing the current reference image. Enforces the pixel budget
 * (rejects > MAX_ANALYSIS_PIXELS, downscales to the working budget), then runs
 * the CV pass in a Worker — or, where Workers are unavailable, synchronously
 * on the next frame. Results are in the same world units as the reference.
 */
export function startReferenceAnalysis(
  reference: ReferenceManager,
  options: VectorizeOptions = {},
): AnalysisJob {
  const jobId = nextJobId++;
  const fail = (message: string): AnalysisJob => ({
    jobId,
    promise: Promise.reject(new AnalysisError(message)),
    cancel() {},
  });

  const state = reference.current;
  if (!state) return fail("분석할 도면이 없습니다.");
  const plan = planAnalysisResolution(state.naturalWidth, state.naturalHeight);
  if (!plan.ok) return fail(plan.message);
  const image = getLoadedImage(state.imageUrl);
  if (!image) return fail("이미지를 아직 불러오는 중입니다. 잠시 후 다시 시도하세요.");

  // Rasterize directly at working resolution: never allocates a source-size canvas.
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fail(FAILURE_MESSAGE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, plan.width, plan.height);
  const imageData = ctx.getImageData(0, 0, plan.width, plan.height);
  // Shrinking to 0×0 frees the backing store now instead of at GC time.
  canvas.width = canvas.height = 0;

  const request: AnalysisRequest = {
    jobId,
    pixels: imageData.data.buffer,
    width: plan.width,
    height: plan.height,
    sourceWidth: plan.sourceWidth,
    sourceHeight: plan.sourceHeight,
    scaleX: plan.scaleX,
    scaleY: plan.scaleY,
    transform: sampleAffineTransform((p) => reference.imagePixelToWorld(p)),
    options: { ...options },
  };

  const target = getWorker();
  if (target) {
    const promise = new Promise<VectorizationResult>((resolve, reject) => {
      pending.set(jobId, { resolve, reject });
    });
    try {
      target.postMessage(request, [request.pixels]);
    } catch {
      pending.delete(jobId);
      return fail(FAILURE_MESSAGE);
    }
    return {
      jobId,
      promise,
      cancel() {
        const entry = pending.get(jobId);
        if (!entry) return;
        pending.delete(jobId);
        // Terminating is the only way to stop a busy worker; a fresh one is
        // created lazily for the next job. Other waiting jobs die with it.
        terminateWorker();
        entry.reject(new AnalysisCancelled());
        rejectAll(() => new AnalysisCancelled());
      },
    };
  }

  // Fallback: no Worker support. Yield a frame so the busy state paints, then run inline.
  let cancelled = false;
  let rejectSync: ((error: Error) => void) | null = null;
  const promise = new Promise<VectorizationResult>((resolve, reject) => {
    rejectSync = reject;
    void nextFrame()
      .then(nextFrame)
      .then(() => {
        if (cancelled) return;
        try {
          resolve(
            vectorizeAtWorkingResolution(
              {
                image: { data: imageData.data, width: plan.width, height: plan.height },
                transform: request.transform,
                scaleX: plan.scaleX,
                scaleY: plan.scaleY,
                sourceWidth: plan.sourceWidth,
                sourceHeight: plan.sourceHeight,
              },
              options,
            ),
          );
        } catch {
          reject(new AnalysisError(FAILURE_MESSAGE));
        }
      });
  });
  return {
    jobId,
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      rejectSync?.(new AnalysisCancelled());
    },
  };
}
