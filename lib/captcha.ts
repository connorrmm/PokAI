'use client';
/**
 * Cloudflare Turnstile, for Supabase's CAPTCHA protection.
 *
 * WHY IT IS NEEDED. The app signs everyone in anonymously so nothing blocks a
 * first scan. That is also a free account factory: my per-account cap of 300
 * scans a day bounds ONE account, and nothing bounds how many a script can
 * create, each with its own 300. Supabase's own advice on enabling anonymous
 * sign-ins says exactly this.
 *
 * WHY TURNSTILE. It is free with no volume cap and passes silently in most
 * cases, where hCaptcha shows puzzles more often. The widget runs at the one
 * moment the app was designed to have no friction, so an invisible check is
 * not a preference here, it is the requirement.
 *
 * INERT UNTIL CONFIGURED. With no NEXT_PUBLIC_TURNSTILE_SITE_KEY this resolves
 * null and everything behaves exactly as before, so the code can ship ahead of
 * the dashboard settings without a coordinated switchover -- and if the key is
 * never added, nothing breaks.
 */

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile {
  render: (el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    'error-callback'?: () => void;
    'timeout-callback'?: () => void;
    size?: 'normal' | 'flexible' | 'compact' | 'invisible';
    appearance?: 'always' | 'execute' | 'interaction-only';
  }) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window { turnstile?: Turnstile }
}

let scriptLoading: Promise<boolean> | null = null;

function loadScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise<boolean>((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(Boolean(window.turnstile));
    s.onerror = () => {
      // A blocked or unreachable script must not strand anyone on a blank
      // screen. Sign-in proceeds without a token; Supabase then rejects it
      // with a message that names the reason, which is better than an app
      // that silently never loads.
      console.warn('Turnstile could not load; continuing without a captcha token');
      resolve(false);
    };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

/**
 * A fresh token, or null when Turnstile is unconfigured or unavailable.
 * Tokens are single-use: call this once per sign-in attempt.
 */
export async function captchaToken(timeoutMs = 8_000): Promise<string | null> {
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!sitekey) return null;
  if (!(await loadScript())) return null;

  const ts = window.turnstile;
  if (!ts) return null;

  return new Promise<string | null>((resolve) => {
    // Off-screen rather than display:none -- Turnstile refuses to run in a
    // container it considers hidden, and a widget that never runs produces no
    // token and no error, which is the worst of both.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px;height:65px;';
    document.body.appendChild(host);

    let done = false;
    let widgetId: string | null = null;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      try { if (widgetId) ts.remove(widgetId); } catch { /* already gone */ }
      host.remove();
      resolve(token);
    };

    // Never hang the app on a challenge that stalls.
    const timer = setTimeout(() => {
      console.warn('Turnstile timed out; continuing without a captcha token');
      finish(null);
    }, timeoutMs);

    try {
      widgetId = ts.render(host, {
        sitekey,
        size: 'flexible',
        appearance: 'interaction-only',
        callback: (token) => { clearTimeout(timer); finish(token); },
        'error-callback': () => { clearTimeout(timer); finish(null); },
        'timeout-callback': () => { clearTimeout(timer); finish(null); },
      });
    } catch (e) {
      clearTimeout(timer);
      console.warn('Turnstile failed to render:', e);
      finish(null);
    }
  });
}
