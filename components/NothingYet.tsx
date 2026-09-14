'use client';
/**
 * What a page shows before there is anything on it.
 *
 * This replaced a sign-in form, and the reason is the whole product decision.
 * An account is no longer created when the app loads -- it is created the
 * moment someone presses the shutter or saves a card, because creating one per
 * mounted component is what split a user's collection across three accounts.
 *
 * The consequence is that a first-time visitor genuinely has no session, and
 * these pages have to say something. A sign-in form would be the wrong thing:
 * it would put back, on every tab, exactly the wall the anonymous session was
 * designed to remove. So they say what to do instead, and getting an account is
 * something that happens on the way past.
 */
export default function NothingYet({
  title, body, signInError,
}: {
  title: string;
  body: string;
  /** Shown only if something actually failed. Rule 4: the real reason. */
  signInError?: string | null;
}) {
  return (
    <div>
      {signInError && (
        <p style={{
          fontSize: 12.5, color: '#FF9C8A', background: 'rgba(232,72,58,0.12)',
          border: '1px solid rgba(232,72,58,0.35)', borderRadius: 12,
          padding: '10px 12px', marginTop: 0,
        }}>
          {signInError}
        </p>
      )}
      <div style={{
        marginTop: 6, padding: 18, borderRadius: 16, textAlign: 'center',
        background: 'var(--panel)', border: '1px dashed var(--border)',
      }}>
        <div className="display" style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '6px 0 0' }}>{body}</p>
      </div>
    </div>
  );
}
