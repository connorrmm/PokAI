import Scanner from '@/components/Scanner';

/**
 * The rebuild, visible at /preview while it is built.
 * '/' still serves the existing single-file app so users keep the working
 * scanner. See the rewrite in next.config.mjs.
 */
export default function Preview() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 64px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>PokAI</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: 13 }}>
        Rebuild preview · the working app is still at <a href="/">/</a>
      </p>
      <div style={{ marginTop: 24 }}><Scanner /></div>
    </main>
  );
}
