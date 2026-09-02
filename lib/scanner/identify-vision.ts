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
export function cropBottomStrip(dataUrl: string, fraction = 0.32, maxWidth = 1568): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sy = Math.round(img.height * (1 - fraction));
      const sh = img.height - sy;
      if (sh < 20) { resolve(null); return; }
      // The width cap is the whole ballgame. Digit sharpness is decided by
      // output width divided by original width -- nothing else. 1568px is the
      // largest edge the API keeps; anything bigger is downscaled on arrival
      // and simply wasted. The 2x ceiling stops us paying tokens for pure
      // interpolation when the source photo is already small.
      const scale = Math.min(maxWidth / img.width, 2);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(sh * scale);
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, sy, img.width, sh, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function identifyWithVision(cardPhoto: string): Promise<VisionScan> {
  const startedAt = Date.now();
  const [small, strip] = await Promise.all([
    downscale(cardPhoto),
    // Crop from the ORIGINAL, not the downscaled copy -- the whole point is to
    // keep resolution the downscale would have thrown away.
    cropBottomStrip(cardPhoto),
  ]);

  const res = await fetch('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: small, bottomStrip: strip, mediaType: 'image/jpeg' }),
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
    usage: u ? {
      inputTokens: u.inputTokens, outputTokens: u.outputTokens,
      model: d.model ?? 'unknown', costUsd: estimateCost(d.model, u.inputTokens, u.outputTokens),
    } : null,
    elapsedMs: Date.now() - startedAt,
  };

  return { result: { ...outcome, diagnostics } as IdentifyResult, vision };
}
