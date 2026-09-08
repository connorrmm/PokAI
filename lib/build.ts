/**
 * Which build am I looking at?
 *
 * This exists because one error message has now been misdiagnosed three times.
 * "This deployment is missing SUPABASE_SERVICE_ROLE_KEY" was blamed on the
 * dashboard, then on a stale deployment, then on a runtime/build-time split in
 * how the environment was read -- and each round cost a message to Sterling and
 * a message back, because nothing in the error said WHICH BUILD PRODUCED IT.
 *
 * An error that cannot be dated is an error that has to be argued about. Every
 * failure the app reports now carries the commit it came from, so "is this the
 * new code?" is answered by reading it rather than by reasoning about it.
 *
 * Read STATICALLY on purpose. This is the one value that should describe the
 * build rather than the running environment: Next replaces it at build time
 * with the commit that was compiled, which is exactly the question being asked.
 */
const SHA = process.env.VERCEL_GIT_COMMIT_SHA || '';
const BUILT_AT = process.env.VERCEL_DEPLOYMENT_ID ? new Date().toISOString() : '';

export interface BuildInfo {
  /** Short commit SHA this bundle was built from, or 'local'. */
  commit: string;
  /** Vercel's environment name, when it set one. */
  env: string | null;
}

export function buildInfo(): BuildInfo {
  return {
    commit: SHA ? SHA.slice(0, 7) : 'local',
    env: process.env.VERCEL_ENV || null,
  };
}

/** A short suffix for an error message, e.g. " (build a1b2c3d)". */
export function buildTag(): string {
  const { commit } = buildInfo();
  return ` (build ${commit})`;
}

export const builtAt = BUILT_AT;
