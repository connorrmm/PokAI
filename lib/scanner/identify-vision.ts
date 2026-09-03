'use client';
/**
 * Client side of vision identification.
 *
 * Downscales before upload. A modern phone photo is 3-4000px wide and costs
 * real money per scan in image tokens, with no accuracy benefit -- a card's
 * name and number are perfectly legible at 1400px. This is the difference
 * between a scan costing fractions of a cent and several cents at scale.
 */
import type { IdentifyResult, ScanDiagnostics, ApiCard } from './types';
import type { CardRead } from './vision-types';

export interface VisionScan {
  result: IdentifyResult;
  vision: CardRead | null;
}

/** Downscale so the longest edge is at most `max` px, re-encoding as JPEG. */
export function downscale(dataUrl: string, max = 1400, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale >= 1) { resolve(dataUrl); return; }
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Published per-million-token rates, so a scan's cost is a real number rather
 * than my estimate. Update if pricing changes.
 */
const RATES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

function estimateCost(model: string | undefined, inTok: number, outTok: number): number {
  const r = RATES[model ?? ''] ?? RATES['claude-haiku-4-5'];
  return (inTok / 1_000_000) * r.in + (outTok / 1_000_000) * r.out;
}

/**
 * A high-resolution crop of the bottom of the card, where the collector number
 * and set symbol are printed.
 *
 * This exists because of a measured failure. Across six real scans the number
 * was read ZERO times, every one reporting 0% certainty, with the model saying
 * each time that the digits were too small or too glared to read. Without a
 * number no print can be uniquely identified, so every scan fell back to a
 * candidate list -- one of them fifty cards long.
 *
 * The cause is partly mine: photos are downscaled to 1400px to control cost,
 * and a collector number is about 2% of a card's height. After downscaling it
 * is a few pixels tall and genuinely unreadable, however good the model.
 *
 * Sending the bottom third separately, capped at 1568px wide rather than the
 * whole card's 1400px longest edge, gives the digits about 2.5x the pixels.
 * Measured cost: roughly 1,500 extra input tokens, about $0.0015 a scan on
 * Haiku, taking a scan from ~$0.0035 to ~$0.005. Worth it if it turns a
 * fifty-card list into one card.
 */
export interface NumberCrops {
  /** Bottom-left corner, where every modern card prints its number. */
  left: string;
  /** Bottom-right corner, where older cards print theirs. */
  right: string;
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Roughly how many pixels tall the collector number's digits are in the
   * crops we send. A collector number is about 2% of a card's height.
   *
   * This is the number that decides whether a scan can identify a print at
   * all. It went 21px (1080p capture) -> 44px (2160p capture) -> ~90px here.
   */
  digitPx: number;
}

/**
 * Magnified crops of the two corners where a collector number can be printed.
 *
 * Replaces a full-width strip of the card's bottom, which spent its entire
 * pixel budget on the parts of the card nobody needs to read. A Kangaskhan ex
 * photographed with a focus score of 499 -- sharp, by any measure -- still came
 * back as "too blurry and obstructed by glare and the Pokemon EX rule box".
 * The frame was fine. The digits were simply too small in what we sent: about
 * 48px, most of the image being rule-box text.
 *
 * Cropping to a corner spends the same budget on a third of the width, which
 * roughly doubles the digits to ~90px. Two corners because placement moved:
 * modern cards print bottom-left, older ones bottom-right. Both are sent
 * labelled, so the model knows what it is looking at rather than hunting.
 *
 * The vertical extent is deliberately generous. A camera capture is padded
 * (PAD = 0.22 in Scanner.tsx) so the card's bottom edge sits around 85% down,
 * while an uploaded photo is usually full-bleed and the edge sits at 100%. A
 * range that fits only the padded case would miss the number entirely on every
 * uploaded photo -- the path that exists precisely so a scan can be repeated.
 */
export function cropNumberRegions(dataUrl: string, maxWidth = 1100): Promise<NumberCrops | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const TOP = 0.72;          // covers a padded capture AND a full-bleed upload
      const SIDE = 0.37;         // a little over a third of the width
      const sy = Math.round(img.height * TOP);
      const sh = img.height - sy;
      const sw = Math.round(img.width * SIDE);
      if (sh < 20 || sw < 20) { resolve(null); return; }

      const scale = Math.min(maxWidth / sw, 3);
      const outW = Math.round(sw * scale);
      const outH = Math.round(sh * scale);

      const draw = (sx: number): string | null => {
        const c = document.createElement('canvas');
        c.width = outW; c.height = outH;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        return c.toDataURL('image/jpeg', 0.92);
      };

      const left = draw(0);
      const right = draw(img.width - sw);
      if (!left || !right) { resolve(null); return; }

      resolve({
        left, right,
        sourceWidth: img.width,
        sourceHeight: img.height,
        digitPx: Math.round(img.height * 0.02 * scale),
      });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function identifyWithVision(cardPhoto: string): Promise<VisionScan> {
  const startedAt = Date.now();
  const [small, crops] = await Promise.all([
    downscale(cardPhoto),
    // Crop from the ORIGINAL, not the downscaled copy -- the whole point is to
    // keep resolution the downscale would have thrown away.
    cropNumberRegions(cardPhoto),
  ]);

  const res = await fetch('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: small,
      numberCrops: crops ? { left: crops.left, right: crops.right } : null,
      mediaType: 'image/jpeg',
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Rule 4: carry the real message up rather than a generic failure.
    throw new Error(json?.error?.message || `Identification failed (${res.status})`);
  }

  const vision: CardRead | null = json?.vision ?? null;
  const outcome = json?.outcome;
  const d = json?.diagnostics ?? {};

  const u = json?.usage;
  const diagnostics: ScanDiagnostics = {
    ocrText: vision?.name ?? '',
    ocrStrategy: `vision:${d.model ?? 'unknown'}`,
    numberText: vision?.number ?? null,
    candidatesFound: d.candidatesFound ?? 0,
    // The scan's overall confidence, not a name-similarity score. It was
    // previously labelled "name score" in the UI, which was simply wrong.
    topScore: typeof outcome?.confidence === 'number' ? outcome.confidence : null,
    topName: outcome?.ok ? outcome.apiCard?.name
      : (outcome?.candidates?.[0] as ApiCard | undefined)?.name ?? null,
    autoAcceptFloor: d.autoAcceptFloor ?? null,
    uniquelyResolved: Boolean(d.uniquelyResolved),
    setTotalMatchCount: typeof d.setTotalMatchCount === 'number' ? d.setTotalMatchCount : null,
    numberDetail: crops ? {
      sourceWidth: crops.sourceWidth,
      sourceHeight: crops.sourceHeight,
      digitPx: crops.digitPx,
    } : null,
    usage: u ? {
      inputTokens: u.inputTokens, outputTokens: u.outputTokens,
      model: d.model ?? 'unknown', costUsd: estimateCost(d.model, u.inputTokens, u.outputTokens),
    } : null,
    elapsedMs: Date.now() - startedAt,
  };

  return { result: { ...outcome, diagnostics } as IdentifyResult, vision };
}
