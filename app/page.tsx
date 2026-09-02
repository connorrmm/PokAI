import Scanner from '@/components/Scanner';
import SetupStatus from '@/components/SetupStatus';

/**
 * The scanner, at '/'.
 *
 * This is the default because it is the version with the vision model. The
 * original single-file app remains at '/classic' for the screens not yet
 * ported, but it can only run on-device OCR, so it must not be what someone
 * lands on when they open the app to scan a card.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 64px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>PokAI</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: 13 }}>
        Scan → Know → Track → Grow
      </p>
      <div style={{ marginTop: 24 }}>
        <SetupStatus />
        <Scanner />
      </div>
      <p style={{ marginTop: 32, fontSize: 12, color: 'var(--muted)' }}>
        <a href="/compare">Compare models on one photo</a> — measures accuracy, cost
        and speed across every option, on the same image.
      </p>
      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
        Portfolio and tournaments are not ported yet — they are in the{' '}
        <a href="/classic">classic app</a>, which uses the older on-device
        reader and cannot identify cards as accurately.
      </p>
    </main>
  );
}
