/**
 * Placeholder shell for the rebuilt app.
 *
 * The live product is still the single-file build served from index.html on
 * main. This Next.js app is being built alongside it on a branch, so Vercel
 * previews can exercise the API without touching what users see. The scanner
 * UI is ported screen by screen; nothing here replaces production until it is
 * demonstrably better.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>PokAI</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>Scan → Know → Track → Grow</p>

      <section style={{
        marginTop: 32, padding: 20, background: 'var(--panel)',
        border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Rebuild in progress</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
          This is the Next.js rebuild. The scanner logic has been ported and is
          covered by tests; the interface is being moved across next. The live
          app remains the single-file build until this is genuinely better.
        </p>
        <p style={{ fontSize: 14 }}>
          API health: <a href="/api/health">/api/health</a>
        </p>
      </section>
    </main>
  );
}
