'use client';
/**
 * What the collection is made of, by rarity.
 *
 * A brand-new portfolio has no history, so there is no line to draw -- value
 * tracking starts the day someone starts. The prototype filled that space with
 * a hardcoded sparkline, which is the one thing product rule 2 forbids: a
 * picture of price movement that never happened.
 *
 * This is the honest alternative. It needs no history, it is true the moment
 * the first card is saved, and it answers a question a total cannot: not just
 * what a collection is worth, but what it IS.
 *
 * COLOUR. The tier colours are the prototype's own. Run through the palette
 * validator they pass colour-blind separation (worst adjacent pair dE 10.4)
 * and contrast (all five above 3:1), but fail perceptual uniformity -- the
 * "common" grey-blue reads as grey. Rather than repaint a brand for a chart,
 * every segment carries a WRITTEN label with its count and value, so identity
 * never depends on colour. Colour is reinforcement here, not information.
 */
import { tierOf, TIER_LABEL, TIER_COLOUR, type Tier } from '@/lib/tier';

interface Holding {
  rarity: string | null;
  quantity: number;
  marketPrice: number | null;
}

/** Fixed order, cheapest to rarest. Never sorted by size: a collection whose
 *  bar reshuffles as it grows is harder to read across visits. */
const ORDER: Tier[] = ['common', 'uncommon', 'rare', 'holo', 'secret'];

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Composition({ holdings }: { holdings: Holding[] }) {
  if (holdings.length === 0) return null;

  const byTier = new Map<Tier, { cards: number; value: number; unpriced: number }>();
  for (const t of ORDER) byTier.set(t, { cards: 0, value: 0, unpriced: 0 });

  for (const h of holdings) {
    const t = byTier.get(tierOf(h.rarity))!;
    t.cards += h.quantity;
    if (typeof h.marketPrice === 'number') t.value += h.marketPrice * h.quantity;
    else t.unpriced += h.quantity;
  }

  const present = ORDER.filter((t) => byTier.get(t)!.cards > 0);
  const totalCards = present.reduce((n, t) => n + byTier.get(t)!.cards, 0);
  if (totalCards === 0) return null;

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        margin: '22px 0 8px',
      }}>
        <span className="display" style={{ fontSize: 13, fontWeight: 600 }}>What you hold</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>by rarity</span>
      </div>

      {/* One stacked bar. 2px gaps so adjacent segments read as separate marks
          rather than one continuous band. */}
      <div style={{ display: 'flex', gap: 2, height: 10, marginBottom: 12 }}>
        {present.map((t) => {
          const share = byTier.get(t)!.cards / totalCards;
          return (
            <div
              key={t}
              title={`${TIER_LABEL[t]}: ${byTier.get(t)!.cards}`}
              style={{
                width: `${share * 100}%`,
                background: TIER_COLOUR[t],
                borderRadius: 3,
                minWidth: 4,
              }}
            />
          );
        })}
      </div>

      {/* The written legend. This, not the bar, is what makes the breakdown
          readable -- the bar shows proportion, the rows carry the facts. */}
      {present.map((t) => {
        const d = byTier.get(t)!;
        return (
          <div key={t} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 0', fontSize: 12,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
              background: TIER_COLOUR[t],
            }} />
            <span style={{ flex: 1 }}>{TIER_LABEL[t]}</span>
            <span className="mono" style={{ color: 'var(--muted)' }}>
              {d.cards} card{d.cards === 1 ? '' : 's'}
            </span>
            <span className="mono" style={{ width: 84, textAlign: 'right', fontWeight: 600 }}>
              {d.value > 0 ? money(d.value) : (
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>—</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
