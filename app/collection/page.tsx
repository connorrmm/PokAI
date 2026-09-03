import Collection from '@/components/Collection';

export const metadata = { title: 'My collection — PokAI' };

export default function CollectionPage() {
  return (
    <main className="frame" style={{ padding: '22px 20px 64px' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          My collection
        </h1>
        <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 12 }}>
          Every card you have scanned and kept
        </p>
      </header>
      <Collection />
      <p style={{ marginTop: 28, fontSize: 12 }}>
        <a href="/">← Back to scanning</a>
      </p>
    </main>
  );
}
