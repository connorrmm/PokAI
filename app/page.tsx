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
    <main className="frame" style={{ padding: '22px 20px 64px' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20,
      }}>
        <div>
          <h1 className="display" style={{
            fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '0.2px',
          }}>
            PokAI
          </h1>
          <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 12 }}>
            Scan → Know → Track → Grow
          </p>
        </div>
        {/* The prototype's live pill. It says the card data behind a scan is
            current, which is the whole basis for trusting a price. */}
        <span className="mono" style={{
          fontSize: 10.5, color: 'var(--muted)', background: 'rgba(28,27,46,0.7)',
          border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 20,
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--mint)', boxShadow: '0 0 8px var(--mint)',
          }} />
          LIVE PRICES
        </span>
      </header>
      <div>
        <SetupStatus />
        <Scanner />
      </div>
      <p style={{ marginTop: 24, fontSize: 13 }}>
        <a href="/collection">My collection →</a>
      </p>
      <p style={{ marginTop: 24, fontSize: 12, color: 'var(--muted)' }}>
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
