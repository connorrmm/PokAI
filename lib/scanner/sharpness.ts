/**
 * How much fine detail is actually present in a region of a photo.
 *
 * This exists because of two scans of the SAME card, through the same build,
 * seconds apart:
 *
 *   scan A -- read `190/165`, exactly right
 *   scan B -- "severely out of focus and overexposed", nothing read at all
 *
 * Nothing in the code differed. The photo did. Once capture resolution stopped
 * being the limit, shot-to-shot variance became the whole game, and a scanner
 * that works on one press and not the next is not a product.
 *
 * The measure is the variance of the Laplacian: run an edge-detecting kernel
 * over the greyscale image and see how much its output varies. A sharp image
 * has strong edges in some places and none in others, so the variance is high.
 * A blurred one has weak edges everywhere, and a blown-out one has almost no
 * edges at all -- which is why this single number catches both of scan B's
 * complaints, out of focus AND overexposed.
 */
import { toGray } from './image';

/**
 * Variance of the Laplacian over `data`. Higher is sharper. Zero for a flat
 * or too-small image.
 *
 * Scale-dependent by design: only compare scores between images measured at
 * the same size, which is what picking the best of several frames does.
 */
export function sharpnessScore(data: ImageData): number {
  const { width: w, height: h, data: px } = data;
  if (w < 3 || h < 3) return 0;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    gray[p] = toGray(px[i], px[i + 1], px[i + 2]);
  }

  // Sum and sum-of-squares in one pass; variance from those.
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/**
 * Below this, treat the region as carrying no readable fine print.
 *
 * PROVISIONAL. Picked to sit well under the sharpness of ordinary in-focus
 * text and well above a blown-out or defocused crop, but it has not been
 * calibrated against a body of real scans, because none carried a score until
 * this shipped. It is used ONLY to tell the user their photo was poor -- never
 * to reject a scan, never to change what the scanner decides -- so being wrong
 * about it costs a misleading message and nothing else.
 */
export const READABLE_SHARPNESS = 40;
