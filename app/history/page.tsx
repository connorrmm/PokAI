import History from '@/components/History';

export const metadata = { title: 'Scan history — PokAI' };

export default function HistoryPage() {
  return (
    <main className="frame" style={{ padding: '22px 20px 64px' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Scan history</h1>
        <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 12 }}>
          Every card you have scanned and kept
        </p>
      </header>
      <History />
      <p style={{ marginTop: 28, fontSize: 12 }}>
        <a href="/">← Back to scanning</a>
      </p>
    </main>
  );
}
