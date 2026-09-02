'use client';
import { useEffect, useState } from 'react';

/**
 * Plain-language setup status, shown in the app itself.
 *
 * This exists because the alternative was asking a non-technical founder to
 * open a raw JSON endpoint and interpret it. Every time configuration was
 * missing, scanning silently fell back to the weaker reader and looked like
 * poor accuracy instead of a missing setting -- so the app now says which it
 * is, without anyone needing to go and check.
 */
interface ConfigVar { name: string; set: boolean; required: boolean; used_for: string }

export default function SetupStatus() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok' } | { kind: 'missing'; vars: ConfigVar[] } | { kind: 'unreachable'; why: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const missing: ConfigVar[] = (d.config || []).filter((v: ConfigVar) => v.required && !v.set);
        setState(missing.length === 0 ? { kind: 'ok' } : { kind: 'missing', vars: missing });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: 'unreachable', why: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading' || state.kind === 'ok') return null;

  if (state.kind === 'unreachable') {
    return (
      <Banner tone="red" title="Cannot reach the server">
        The app could not check its own settings: {state.why}
      </Banner>
    );
  }

  // Translate variable names into what a non-technical reader needs to know.
  const plain: Record<string, string> = {
    ANTHROPIC_API_KEY:
      'The AI vision model is switched OFF. Scans will use the older on-device reader, which struggles with real photos.',
    TCGAPI_KEY:
      'The card database is not connected, so scans cannot look up card names or prices.',
  };

  return (
    <Banner tone="amber" title="Setup incomplete — scanning will not work properly">
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {state.vars.map((v) => (
          <li key={v.name} style={{ marginBottom: 6 }}>
            {plain[v.name] ?? v.used_for}
            <div style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>
              add {v.name} in Vercel → Settings → Environment Variables, then redeploy
            </div>
          </li>
        ))}
      </ul>
    </Banner>
  );
}

function Banner({ tone, title, children }: {
  tone: 'amber' | 'red'; title: string; children: React.ReactNode;
}) {
  const c = tone === 'red'
    ? { bg: 'rgba(232,72,58,0.10)', bd: 'rgba(232,72,58,0.35)', fg: '#E8483A' }
    : { bg: 'rgba(255,194,77,0.10)', bd: 'rgba(255,194,77,0.35)', fg: '#FFC24D' };
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 10,
      padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.5,
    }}>
      <strong style={{ color: c.fg }}>{title}</strong>
      <div>{children}</div>
    </div>
  );
}
