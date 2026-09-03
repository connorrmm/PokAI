import Portfolio from '@/components/Portfolio';

export const metadata = { title: 'Portfolio — PokAI' };

export default function PortfolioPage() {
  return (
    <main className="frame" style={{ padding: '22px 20px 64px' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Portfolio</h1>
        <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 12 }}>
          What your collection is worth, and what it has been worth
        </p>
      </header>
      <Portfolio />
      <p style={{ marginTop: 28, fontSize: 12 }}>
        <a href="/collection">Every card →</a>{'  ·  '}<a href="/">Scan a card →</a>
      </p>
    </main>
  );
}
