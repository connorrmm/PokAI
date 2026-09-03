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

/**
 * Fraction of a region that is blown out to near-white, 0..1.
 *
 * Glare and blur are different problems with OPPOSITE fixes, and the scanner
 * was telling users the wrong one. Sterling's own diagnosis after a session of
 * testing: "if there is glare and it is not clear to see the name,
 * illustration, and the number, it is almost impossible for it to catch it."
 * He is right, and a frame can be pin-sharp and still be a mirror -- one scan
 * scored 499 for sharpness and read nothing at all.
 *
 * Telling someone to hold steadier when the real problem is a reflection sends
 * them to do more of what already failed. Tilting the card a few degrees moves
 * the reflection off the print; focusing harder does nothing.
 *
 * Measured on luminance rather than any single channel, so coloured foil that
 * clips in one channel but not overall is not counted as glare.
 */
export function clippedFraction(data: ImageData): number {
  const { width: w, height: h, data: px } = data;
  const n = w * h;
  if (n === 0) return 0;
  let clipped = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (toGray(px[i], px[i + 1], px[i + 2]) >= 245) clipped++;
  }
  return clipped / n;
}

/**
 * Above this fraction of blown-out pixels, glare is the story rather than a
 * highlight on a foil card.
 *
 * PROVISIONAL, like READABLE_SHARPNESS, and used only to choose which sentence
 * to show the user. It never rejects a scan or changes what the scanner
 * decides, so being wrong about it costs a misleading message.
 */
export const GLARE_FRACTION = 0.18;

/**
 * How good a frame is for reading small print: sharp, and not a mirror.
 *
 * Ranking on sharpness alone picked frames that were crisply in focus on a
 * white reflection. Glare shifts slightly between frames as the hand moves, so
 * there is usually a better one in a burst -- but only if the ranking can see
 * the difference.
 */
export function frameScore(data: ImageData): { sharpness: number; clipped: number; score: number } {
  const sharpness = sharpnessScore(data);
  const clipped = clippedFraction(data);
  return { sharpness, clipped, score: sharpness * (1 - clipped) };
}
