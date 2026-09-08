/**
 * The rules around signing in.
 *
 * Two things are being protected here. A password rule that rejects for a
 * reason it will not name is a dead end, and this project's whole rule 4 exists
 * because dead ends cost days. And an auth error that gets paraphrased loses
 * the provider's exact words -- which are the only thing that makes a report
 * from Sterling's phone diagnosable from here.
 */
import { describe, it, expect } from 'vitest';
import {
  passwordProblem, emailLooksWrong, normaliseEmail, explainAuthError, MIN_PASSWORD,
} from '../lib/auth';

describe('passwordProblem', () => {
  it('accepts an ordinary passphrase', () => {
    expect(passwordProblem('correct horse battery')).toBeNull();
  });

  it('says how short it is, not just that it is short', () => {
    const msg = passwordProblem('short');
    expect(msg).toContain(String(MIN_PASSWORD));
    expect(msg).toContain('5');   // "this one has 5"
  });

  it('rejects nothing at all with something to do about it', () => {
    expect(passwordProblem('')).toBe('Choose a password.');
  });

  it('catches the 72-byte limit before the provider does', () => {
    // bcrypt truncates silently at 72 bytes; Supabase rejects outright. Either
    // way the user cannot act on what comes back.
    expect(passwordProblem('a'.repeat(73))).toContain('72');
    expect(passwordProblem('a'.repeat(72))).toBeNull();
  });

  it('counts BYTES, not characters', () => {
    // 40 emoji is 40 characters and 160 bytes. Counting characters would let
    // this through to a rejection nobody could interpret.
    expect(passwordProblem('🎴'.repeat(40))).toContain('72');
  });
});

describe('email checks', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Sterling@Example.COM ')).toBe('sterling@example.com');
  });

  it('quotes what was typed, so a typo is visible', () => {
    expect(emailLooksWrong('sterling@example')).toContain('sterling@example');
  });

  it('accepts a real address', () => {
    expect(emailLooksWrong(' Sterling@Example.com ')).toBeNull();
  });

  it('asks for one when it is blank', () => {
    expect(emailLooksWrong('   ')).toBe('Enter your email address.');
  });
});

describe('explainAuthError', () => {
  it('turns the commonest failure into something actionable', () => {
    const out = explainAuthError('Invalid login credentials');
    expect(out).toContain('do not match');
    expect(out).toContain('Forgot your password');
  });

  it('keeps the provider\'s exact words for the ones that name a setting', () => {
    // "Signups not allowed for this instance" is a switch in a dashboard.
    // Paraphrasing it away would send someone hunting in the wrong place.
    const out = explainAuthError('Signups not allowed for this instance');
    expect(out).toContain('Signups not allowed for this instance');
    expect(out).toContain('Authentication → Providers');
  });

  it('passes an unrecognised message through untouched', () => {
    // A wrong guess about what a message means is worse than no guess.
    expect(explainAuthError('Database error saving new user'))
      .toBe('Database error saving new user');
  });

  it('does not swallow a rate limit', () => {
    const out = explainAuthError('Email rate limit exceeded');
    expect(out).toContain('Email rate limit exceeded');
    expect(out).toContain('Wait a minute');
  });
});
