'use client';
import { useState } from 'react';
import Scanner from './Scanner';
import Portfolio from './Portfolio';
import SetupStatus from './SetupStatus';

type Tab = 'scan' | 'portfolio';

export default function Home() {
  const [tab, setTab] = useState<Tab>('scan');

  return (
    <main className="frame" style={{ padding: '22px 20px 64px' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
      }}>
        <div>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '0.2px' }}>
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

      <div role="tablist" aria-label="PokAI sections" style={{
        display: 'flex', gap: 6, background: 'rgba(255,255,255,0.04)',
        borderRadius: 14, padding: 4, marginBottom: 14,
      }}>
        {([['scan', 'Scan'], ['portfolio', 'Portfolio']] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id} role="tab" aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="display"
            style={{
              flex: 1, border: 'none', cursor: 'pointer', padding: '10px 8px',
              borderRadius: 11, fontWeight: 600, fontSize: 12.5,
              background: tab === id ? 'var(--panel)' : 'transparent',
              color: tab === id ? 'var(--accent-warm)' : 'var(--muted)',
              boxShadow: tab === id ? '0 4px 12px rgba(0,0,0,0.25)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <SetupStatus />

      {/*
        Both tabs stay MOUNTED, with the inactive one hidden.
        Unmounting the scanner would tear down the camera every time someone
        glanced at their portfolio, and unmounting the portfolio would refetch
        it -- and each fetch records a value snapshot, so switching tabs would
        write to the database repeatedly.
      */}
      <div hidden={tab !== 'scan'}><Scanner /></div>
      <div hidden={tab !== 'portfolio'}><Portfolio active={tab === 'portfolio'} /></div>

      <p style={{ marginTop: 28, fontSize: 12, color: 'var(--muted)' }}>
        <a href="/collection">Every card</a>{'  ·  '}
        <a href="/history">Scan history</a>{'  ·  '}
        <a href="/compare">Compare models</a>
      </p>
    </main>
  );
}
