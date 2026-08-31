/**
 * Pure image maths from the scanner pipeline. No DOM, so it is testable.
 * The canvas/Tesseract parts live in ocr-client.ts.
 */

/**
 * Otsu's method: find the threshold that best separates a grayscale histogram
 * into two classes (ink vs background) by maximising between-class variance.
 * Far more robust than a flat contrast stretch when lighting is uneven or
 * there is foil glare -- which is most Pokemon cards worth scanning.
 *
 * The plateau handling is not incidental. When several thresholds are equally
 * optimal -- a wide empty gap between clusters, e.g. clean background versus
 * text with nothing in between -- the naive "first winner" lands exactly on
 * one cluster's edge, which misclassifies borderline real-world pixels under
 * noise. Taking the midpoint of the plateau puts the threshold in the gap
 * where it belongs.
 */
export function otsuThreshold(hist: ArrayLike<number>, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, varMax = -1;
  let plateauStart = 0, plateauEnd = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > varMax) { varMax = between; plateauStart = t; plateauEnd = t; }
    else if (between === varMax) { plateauEnd = t; }
  }
  return Math.round((plateauStart + plateauEnd) / 2);
}

/**
 * Percentile contrast clip: find the value range to stretch to, ignoring the
 * brightest and darkest `fraction` of pixels so one glare hotspot or a
 * shadowed corner cannot skew the whole image.
 */
export function percentileRange(
  hist: ArrayLike<number>, total: number, fraction = 0.02,
): { lo: number; hi: number } {
  const clip = Math.max(1, Math.round(total * fraction));
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= clip) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= clip) { hi = v; break; } }
  return { lo, hi };
}

/** Rec. 601 luma, matching the prototype. */
export function toGray(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Hamming distance between two perceptual hashes.
 * Returns null when the signal is unusable -- the caller must treat that as
 * "no information", never as evidence against a card.
 */
export function hammingDistance(a: string | null, b: string | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Convert a 64-bit aHash distance into a 0..100 similarity. */
export function hashSimilarity(distance: number | null, bits = 64): number | null {
  if (distance === null) return null;
  return Math.round(((bits - distance) / bits) * 100);
}
