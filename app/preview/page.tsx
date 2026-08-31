/**
 * The rebuild, visible at /preview while it is built.
 *
 * '/' deliberately still serves the existing single-file app so users keep the
 * working scanner. See the rewrite in next.config.mjs.
 */
export default function Preview() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>PokAI — rebuild preview</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>Scan → Know → Track → Grow</p>

      <section style={{
        marginTop: 32, padding: 20, background: 'var(--panel)',
        border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>What is here so far</h2>
        <ul style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
          <li>Scanner decision logic ported and under test</li>
          <li>Card search API with the provider key held server-side</li>
          <li>Database schema live, with row-level security verified</li>
        </ul>
        <p style={{ fontSize: 14 }}>
          The working app is still at <a href="/">/</a>. API health:{' '}
          <a href="/api/health">/api/health</a>
        </p>
      </section>
    </main>
  );
}
