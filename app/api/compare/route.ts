import { NextResponse } from 'next/server';
import { readCardFromImage } from '@/lib/vision';
import { rateLimit, clientKey } from '@/lib/rate-limit';

/**
 * Run ONE photo through several model configurations and report what each
 * read, what it cost, and how long it took.
 *
 * This exists because the model choice is a real money decision -- measured at
 * $0.0268 per scan on the default, or $268 a month at ten thousand scans -- and
 * my published estimate for it was wrong by more than double. Choosing the
 * cheaper option on my reasoning again would be repeating the mistake.
 *
 * Comparing on the SAME photo is the whole point. Every camera scan is a
 * different photo, so a cheaper model looking good could just be an easier
 * shot.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

const RATES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

const CONFIGS: Array<{ label: string; model: string; effort?: 'low' | 'medium' | 'high' }> = [
  { label: 'Opus 5 (current default)', model: 'claude-opus-5' },
  { label: 'Opus 5, low effort', model: 'claude-opus-5', effort: 'low' },
  { label: 'Sonnet 5', model: 'claude-sonnet-5' },
  { label: 'Haiku 4.5', model: 'claude-haiku-4-5' },
];

export async function POST(req: Request) {
  // Each run costs real money and calls the API several times.
  const rl = rateLimit(`compare:${clientKey(req)}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { message: 'Too many comparisons. Wait a minute.', code: 'rate_limited' } },
      { status: 429 },
    );
  }

  let body: { image?: string; mediaType?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: { message: 'Body must be JSON', code: 'bad_request' } }, { status: 400 });
  }
  const image = (body.image || '').replace(/^data:image\/[a-z+]+;base64,/, '');
  if (!image) {
    return NextResponse.json({ error: { message: 'Missing image', code: 'bad_request' } }, { status: 400 });
  }
  const mediaType = (['image/jpeg', 'image/png', 'image/webp'].includes(body.mediaType || '')
    ? body.mediaType : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';

  // In parallel: one slow model must not make the whole comparison slow.
  const results = await Promise.all(CONFIGS.map(async (c) => {
    try {
      const v = await readCardFromImage(image, mediaType, { model: c.model, effort: c.effort });
      const r = RATES[c.model] ?? RATES['claude-opus-5'];
      const costUsd = (v.inputTokens / 1e6) * r.in + (v.outputTokens / 1e6) * r.out;
      return {
        label: c.label, model: c.model, effort: c.effort ?? 'default', ok: true as const,
        name: v.read.name, number: v.read.number, setName: v.read.set_name,
        rarity: v.read.rarity, legibility: v.read.legibility,
        nameConfidence: v.read.confidence,
        numberConfidence: v.read.number_confidence,
        setConfidence: v.read.set_confidence,
        notes: v.read.notes,
        inputTokens: v.inputTokens, outputTokens: v.outputTokens,
        costUsd, costPer1000: costUsd * 1000, elapsedMs: v.elapsedMs,
      };
    } catch (e) {
      // A model failing is a real result, not a reason to lose the others.
      return {
        label: c.label, model: c.model, effort: c.effort ?? 'default', ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }));

  return NextResponse.json({ results });
}
