import PortfolioView, { type Data } from '@/components/PortfolioView';
import { computeCollectionScore, achievements } from '@/lib/score';

export const metadata = { title: 'Portfolio preview — PokAI' };

/**
 * A look at the portfolio with a collection in it.
 *
 * WHY THIS EXISTS. A real portfolio is empty until someone scans, and prices
 * need the card catalog. Neither is a good state to be looking at when the
 * question is "what does this product look like". This renders THE REAL
 * COMPONENT with sample numbers, so what is on screen is genuinely the design
 * -- a mockup built separately drifts from the product within days and then
 * misrepresents it, which matters most in exactly the situation a preview
 * exists for.
 *
 * LABELLED, DELIBERATELY AND LOUDLY. Every number below is invented. Product
 * rule 2 forbids presenting a fabricated value as real, and that rule does not
 * stop applying because the audience is in a meeting rather than a collection.
 * A preview that could be mistaken for a real collection is worse than no
 * preview: it is a claim nobody meant to make.
 */

const CARDS = [
  { name: 'Charizard ex', set: 'SV: Obsidian Flames', number: '223/197', rarity: 'Special Illustration Rare', price: 289.4, qty: 1, condition: 'Near Mint' },
  { name: 'Flareon', set: 'SV: Prismatic Evolutions', number: '013/131', rarity: 'Rare', price: 0.33, qty: 3, condition: null },
  { name: 'Kangaskhan ex', set: 'SV: Scarlet & Violet 151', number: '190/165', rarity: 'Ultra Rare', price: 5.58, qty: 1, condition: 'Near Mint' },
  { name: 'Froakie', set: 'ME04: Chaos Rising', number: '088/086', rarity: 'Illustration Rare', price: 7.43, qty: 1, condition: 'Lightly Played' },
  { name: 'Mega Pyroar ex', set: 'ME04: Chaos Rising', number: '015/086', rarity: 'Double Rare', price: 0.61, qty: 2, condition: null },
  { name: 'Dipplin', set: 'SV: Prismatic Evolutions', number: '010/131', rarity: 'Uncommon', price: 0.19, qty: 4, condition: null },
  { name: 'Goldeen', set: 'SV: Scarlet & Violet 151', number: '118/165', rarity: 'Common', price: 0.18, qty: 6, condition: null },
  { name: 'Umbreon VMAX', set: 'SWSH07: Evolving Skies', number: '215/203', rarity: 'Secret Rare', price: 412.75, qty: 1, condition: 'Near Mint' },
  { name: 'Pikachu', set: 'SV: Scarlet & Violet 151', number: '025/165', rarity: 'Common', price: 0.42, qty: 2, condition: null },
  { name: 'Mew ex', set: 'SV: Scarlet & Violet 151', number: '193/165', rarity: 'Ultra Rare', price: 41.2, qty: 1, condition: 'Near Mint' },
  { name: 'Snorlax', set: 'SWSH04: Vivid Voltage', number: '131/185', rarity: 'Rare Holo', price: 3.11, qty: 1, condition: null },
  { name: 'Gengar', set: 'Legendary Collection', number: '013/110', rarity: 'Holo Rare', price: 96.5, qty: 1, condition: 'Moderately Played' },
];

function sampleData(): Data {
  const items = CARDS.map((c, i) => ({
    id: i + 1,
    name: c.name, setName: c.set, number: c.number, rarity: c.rarity,
    imageUrl: null, marketPrice: c.price, quantity: c.qty, condition: c.condition,
  }));

  const marketValue = Math.round(items.reduce((n, i) => n + i.marketPrice * i.quantity, 0) * 100) / 100;
  const cards = items.reduce((n, i) => n + i.quantity, 0);
  const scoreCards = items.map((i) => ({ rarity: i.rarity, setName: i.setName, quantity: i.quantity }));

  // Fourteen days ending at today's real total, wandering the way a card
  // market actually does -- fixed, not random, so the picture is the same
  // every time it is shown.
  const drift = [0.938, 0.944, 0.941, 0.957, 0.963, 0.959, 0.971, 0.968, 0.979, 0.985, 0.981, 0.99, 0.996, 1];
  const series = drift.map((f, i) => ({
    day: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
    value: Math.round(marketValue * f * 100) / 100,
  }));
  const previous = series[series.length - 2].value;

  return {
    totals: { cards, valued: cards, unpriced: 0, marketValue },
    change: {
      since: series[series.length - 2].day,
      absolute: Math.round((marketValue - previous) * 100) / 100,
      percent: Math.round(((marketValue - previous) / previous) * 1000) / 10,
    },
    valuationUnavailable: false,
    pricesUnavailable: null,
    series,
    top: [...items].sort((a, b) => b.marketPrice * b.quantity - a.marketPrice * a.quantity).slice(0, 5),
    recent: items.slice(0, 8),
    all: items.map((i) => ({ rarity: i.rarity, quantity: i.quantity, marketPrice: i.marketPrice })),
    score: computeCollectionScore({ totalValue: marketValue, cards: scoreCards }),
    achievements: achievements({ cardCount: cards, totalValue: marketValue, cards: scoreCards }),
    itemCount: items.length,
  };
}

export default function PortfolioPreview() {
  return (
    <main className="frame" style={{ padding: '22px 20px 64px' }}>
      <header style={{ marginBottom: 14 }}>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Portfolio</h1>
        <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 12 }}>
          What your collection is worth, and what it has been worth
        </p>
      </header>

      {/* Unmissable, and it stays. A preview that could be mistaken for a real
          collection is a claim nobody meant to make. */}
      <div style={{
        padding: '10px 12px', borderRadius: 12, marginBottom: 14,
        background: 'rgba(255,176,32,0.10)', border: '1px solid rgba(255,176,32,0.35)',
        fontSize: 12, color: 'var(--gold)', fontWeight: 600,
      }}>
        Preview — every card and price below is made up, to show the layout.
        This is not a real collection.
      </div>

      <PortfolioView data={sampleData()} />

      <p style={{ marginTop: 28, fontSize: 12 }}>
        <a href="/">← Back to the app</a>
      </p>
    </main>
  );
}
