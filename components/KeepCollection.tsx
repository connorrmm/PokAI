'use client';
/**
 * Attach an email and password to an anonymous account, so a collection
 * outlives the browser it was made in.
 *
 * The app signs everyone in anonymously so nothing blocks a first scan. That
 * account is real and private, but it lives in ONE browser's storage: clearing
 * site data, switching phones, or private browsing loses it, with no warning
 * and no way back. Offering the upgrade is the other half of that decision --
 * without it, "no sign-up needed" quietly means "your collection can vanish".
 *
 * Shown once a collection is worth keeping rather than on first open, because
 * asking for an email before someone has scanned anything is the friction the
 * anonymous session existed to remove.
 */
import { useState } from 'react';
import Account from './Account';

export default function KeepCollection({ cardCount }: { cardCount: number }) {
  const [open, setOpen] = useState(false);

  if (cardCount < 1) return null;

  return (
    <div style={{
      marginTop: 20, padding: 14, borderRadius: 16,
      background: 'rgba(255,176,32,0.06)', border: '1px solid rgba(255,176,32,0.28)',
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--fg)', fontWeight: 600 }}>
        This collection only exists in this browser
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
        {cardCount} card{cardCount === 1 ? '' : 's'} saved. Clearing your browser data or
        switching phones would lose them. An email and password keeps them, and lets you
        open your collection on any device.
      </p>

      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-ghost"
                style={{ width: '100%', padding: 11, marginTop: 10, fontSize: 13, cursor: 'pointer' }}>
          Keep my collection
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <Account isAnonymous cardCount={cardCount} />
        </div>
      )}
    </div>
  );
}
