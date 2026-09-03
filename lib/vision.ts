import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

/**
 * Vision-based card reading.
 *
 * WHY THIS REPLACES OCR: Tesseract matches letter shapes. A phone photo with
 * slight blur, foil glare, or a few degrees of tilt gives it nothing to match,
 * and no tuning fixes that -- it is the wrong tool for photographs taken by
 * real people in real lighting, which is every photograph this product will
 * ever receive.
 *
 * A vision model reads the card the way a person does: the name, the number,
 * the set symbol, the art, the layout. It degrades gracefully on a poor photo
 * instead of failing outright.
 *
 * The never-guess rule still governs the outcome. The model is explicitly
 * instructed to report what it CANNOT read rather than inventing it, and to
 * offer alternatives when a name is ambiguous. Those alternatives widen the
 * candidate search; they never become an answer on their own.
 */

/**
 * Model is configurable so the accuracy/cost tradeoff is a setting, not a
 * rewrite. Override with POKAI_VISION_MODEL.
 *
 * Default chosen by measurement, not reasoning. The same photo of an Eevee ex
 * run through four options on /compare (2026-09-02): all four read the name,
 * number and set correctly, and Haiku reported HIGHER certainty on the number
 * (88 vs 82) and set (88 vs 80) than Opus, slightly faster, at a fifth of the
 * cost -- $6.56 per 1,000 scans against $34.62.
 *
 * I had recommended starting on Opus for accuracy. The measurement did not
 * support it. One card is thin evidence, so re-run /compare as the accuracy
 * set grows; switching back is one environment variable.
 */
const MODEL = process.env.POKAI_VISION_MODEL || 'claude-haiku-4-5';

export const CardReadSchema = z.object({
  is_pokemon_card: z.boolean()
    .describe('False if the image is not a Pokemon trading card at all.'),
  name: z.string().nullable()
    .describe('The Pokemon/card name exactly as printed, or null if genuinely unreadable. Never guess.'),
  alternate_names: z.array(z.string())
    .describe('Other plausible readings if the name is unclear, best first. Empty if confident.'),
  number: z.string().nullable()
    .describe('Collector number as printed, e.g. "025/185". Null if unreadable.'),
  number_confidence: z.number().min(0).max(100)
    .describe('How certain you are of the collector number specifically, 0-100. If the digits were small, blurred or guessed from context, say so with a low number. 0 if you did not read it.'),
  set_name: z.string().nullable()
    .describe('Set name if legible or identifiable from the set symbol. Null if not.'),
  set_confidence: z.number().min(0).max(100)
    .describe('How certain you are of the SET specifically, 0-100. Reading a clear set symbol or code deserves a high number; inferring the set from artwork style deserves a low one. 0 if unknown.'),
  rarity: z.string().nullable()
    .describe('Rarity if determinable, e.g. "Rare Holo", "Illustration Rare". Null if not.'),
  holo_pattern: z.enum(['none', 'master_ball', 'poke_ball', 'cosmos', 'other', 'unknown'])
    .describe(
      'The shape of the holofoil pattern in the card BACKGROUND, which distinguishes prints ' +
      'that are otherwise identical. "master_ball" = repeating Master Ball shapes (purple ball ' +
      'with an M). "poke_ball" = repeating Poke Ball shapes. "cosmos" = a starfield or galaxy ' +
      'sparkle. "none" = flat or ordinary holo with no repeating motif. "other" = a repeating ' +
      'motif that is none of these. "unknown" if the foil is not visible enough to tell -- say ' +
      'unknown rather than guessing, because these prints differ in price by 100x.',
    ),
  hp: z.string().nullable().describe('Printed HP value, or null.'),
  legibility: z.enum(['clear', 'partial', 'poor'])
    .describe('How readable the card actually was in this image.'),
  confidence: z.number().min(0).max(100)
    .describe('How certain you are of the NAME specifically, 0-100. Be honest; a low number is more useful than a wrong high one.'),
  notes: z.string()
    .describe('Brief reason for any uncertainty, e.g. "glare across the name", "card at an angle".'),
});

export type CardRead = z.infer<typeof CardReadSchema>;

const SYSTEM = `You identify Pokémon trading cards from photographs for a collection app.

Photographs from real users are frequently imperfect: motion blur, glare on foil
and holo cards, shadows, fingers at the edges, cards at an angle, low light.
Read what is actually there and degrade gracefully.

Rules that matter more than being helpful:

1. NEVER invent a value. If the collector number is not legible, return null for
   it. A null is useful; a plausible-looking wrong number corrupts a user's
   collection and their valuation.
2. If the name could be more than one card, put your best reading in "name" and
   the other plausible readings in "alternate_names". Do not silently pick one.
3. Confidence fields are per-field and must be calibrated independently. An
   accurate 45 is far more valuable than an optimistic 90, because the app uses
   these numbers to decide whether to ask the user to confirm.
   - "confidence" is about the NAME.
   - "number_confidence" is about the COLLECTOR NUMBER. Small blurred digits you
     half-guessed deserve a low score even when the name is obvious.
   - "set_confidence" is about the SET. Reading a clear set symbol or code is
     high; inferring the set from artwork style is low, however plausible it
     feels.
   These matter more than they look: many cards share a name AND a number across
   different sets, so the app relies on your number and set certainty to decide
   whether it may identify a card outright or must ask the user to choose.
4. Use every clue, not just the text: the artwork, the set symbol, the card
   layout and era, the energy type, the HP. A blurred name over recognisable
   art is still identifiable.
5. If the image is not a Pokémon card at all, set is_pokemon_card false and stop.`;

export interface VisionResult {
  read: CardRead;
  model: string;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

/** Data URLs arrive from the browser; the API wants raw base64. */
function strip64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '');
}

export async function readCardFromImage(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  /** Overrides for a side-by-side comparison. Production passes none. */
  opts?: {
    model?: string;
    effort?: 'low' | 'medium' | 'high';
    /** Magnified crops of the two bottom corners, where a collector number
     *  is printed. See cropNumberRegions(). */
    numberCrops?: { left: string; right: string } | null;
  },
): Promise<VisionResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // Rule 4: name the real cause.
    throw new Error('ANTHROPIC_API_KEY is not set in the server environment');
  }

  // A key can be present and still unusable, and the failure it produces is
  // unreadable: putting a non-ASCII character in an HTTP header throws
  // "Cannot convert argument to a ByteString ... value of 8226", which tells
  // the person who set it nothing at all.
  //
  // 8226 is a bullet. It gets there by copying the key out of a hosting
  // dashboard, which MASKS saved values as dots -- so what gets pasted is the
  // mask, not the key. Catch that specifically and say so.
  const masked = /[\u2022\u00b7\u2219\u25cf\u002a]{3,}/.test(key);
  const nonAscii = /[^\x20-\x7E]/.test(key);
  if (masked || nonAscii) {
    throw new Error(
      'ANTHROPIC_API_KEY looks corrupted -- it contains hidden or non-text characters. '
      + 'This usually means it was copied from the hosting dashboard, which masks saved '
      + 'values as dots, so the dots got saved instead of the key. Re-copy the real key '
      + 'from its original source and paste it in again.',
    );
  }
  if (!key.startsWith('sk-ant-')) {
    throw new Error(
      'ANTHROPIC_API_KEY does not look like an Anthropic key (it should start with "sk-ant-"). '
      + 'Check the value that was saved.',
    );
  }
  const client = new Anthropic({ apiKey: key });
  const startedAt = Date.now();
  const model = opts?.model || MODEL;

  let response;
  try {
    response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        ...(opts?.numberCrops ? [
          { type: 'text' as const, text: 'The next two images are magnified crops of the same card, so the small print is legible. Read the collector number from them rather than from the first image. Modern cards print it in the BOTTOM-LEFT corner (e.g. "190/165"); older cards print it in the BOTTOM-RIGHT (e.g. "4/102"). Only one of the two will have it. Report exactly the digits you can see -- if a digit is genuinely ambiguous, say so in your notes and give the alternative rather than picking one silently.' },
          { type: 'text' as const, text: 'Bottom-LEFT corner:' },
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: strip64(opts.numberCrops.left) } },
          { type: 'text' as const, text: 'Bottom-RIGHT corner:' },
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: strip64(opts.numberCrops.right) } },
        ] : []),
        { type: 'text', text: 'Identify this Pokémon card. Report honestly what you can and cannot read.' },
      ],
    }],
      output_config: { format: zodOutputFormat(CardReadSchema) },
    });
  } catch (e) {
    // Translate the failures a non-technical operator will actually hit.
    // Raw provider JSON in the UI tells the person who has to fix it nothing.
    const raw = e instanceof Error ? e.message : String(e);
    if (raw.includes('credit balance is too low')) {
      throw new Error(
        'The AI account has no credit left, so the card could not be read. '
        + 'Add credit at console.anthropic.com under Plans & Billing. '
        + 'The API key itself is working correctly.',
      );
    }
    if (raw.includes('authentication_error') || raw.includes('invalid x-api-key')) {
      throw new Error(
        'The AI account rejected the API key. Check that ANTHROPIC_API_KEY holds a '
        + 'current, active key from console.anthropic.com.',
      );
    }
    if (raw.includes('rate_limit')) {
      throw new Error('The AI service is rate limiting us right now. Wait a moment and scan again.');
    }
    throw new Error(raw);
  }

  const read = response.parsed_output;
  if (!read) throw new Error('Vision model returned no parsable result');

  return {
    read,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    elapsedMs: Date.now() - startedAt,
  };
}
