/**
 * The rules around signing in, kept away from the UI so they can be tested.
 *
 * Nothing here talks to Supabase. It decides what a password must be, and it
 * turns a provider message into something a person can act on WITHOUT throwing
 * the provider's own words away -- product rule 4 exists because this project
 * has repeatedly lost hours to an app that hid the real error, and "Something
 * went wrong" is exactly as useless during sign-in as it was during a scan.
 */

/** The shortest password we will accept. Supabase's own default floor is 6. */
export const MIN_PASSWORD = 8;

/**
 * Why this password will not do, in plain language, or null if it is fine.
 *
 * Length only, deliberately. Composition rules -- a capital, a digit, a
 * symbol -- push people towards Password1! and away from the long, memorable
 * phrases that are actually harder to guess. Length is the requirement that
 * survives contact with real users.
 */
export function passwordProblem(password: string): string | null {
  if (!password) return 'Choose a password.';
  if (password.length < MIN_PASSWORD) {
    return `Passwords need at least ${MIN_PASSWORD} characters. This one has ${password.length}.`;
  }
  // Supabase rejects anything over 72 bytes outright, and bcrypt silently
  // truncates there. Saying so beats a rejection the user cannot interpret.
  if (new TextEncoder().encode(password).length > 72) {
    return 'That password is too long — 72 characters is the maximum.';
  }
  return null;
}

/** Trimmed and lowercased. Emails are case-insensitive; a stray space is not. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Enough of a check to catch a typo, not an attempt to validate RFC 5322. */
export function emailLooksWrong(email: string): string | null {
  const e = normaliseEmail(email);
  if (!e) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return `"${email.trim()}" does not look like an email address.`;
  return null;
}

/**
 * A provider message, plus what to do about it.
 *
 * The provider's exact words are ALWAYS kept. They are what makes a report
 * diagnosable, and several of these messages mean something quite specific
 * that a paraphrase loses. The added sentence is what the person should
 * actually do, which the provider never says.
 */
export function explainAuthError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('invalid login credentials')) {
    return 'That email and password do not match an account. Check for a typo, '
      + 'or use "Forgot your password?" below.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account still needs confirming. Open the link in the email we sent, '
      + `then sign in again. (${message})`;
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'There is already an account with that email. Sign in with it instead — '
      + `or use "Forgot your password?" if you cannot remember it. (${message})`;
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return `Too many attempts in a short time. Wait a minute and try again. (${message})`;
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'New accounts are switched off in the Supabase dashboard '
      + `(Authentication → Providers → Email). (${message})`;
  }
  if (m.includes('password')) {
    // Supabase's own password policy, whatever it has been set to.
    return message;
  }
  // Unrecognised: hand it over exactly as it came. A wrong guess about what a
  // message means is worse than no guess.
  return message;
}
