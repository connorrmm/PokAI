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

export async function identifyWithVision(cardPhoto: string): Promise<VisionScan> {
  const startedAt = Date.now();
  const small = await downscale(cardPhoto);

  const res = await fetch('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: small, mediaType: 'image/jpeg' }),
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
