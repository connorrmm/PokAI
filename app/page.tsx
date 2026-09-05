import Home from '@/components/Home';

/**
 * The app, at '/'.
 *
 * Scanning and the portfolio live on ONE screen behind tabs, the way the
 * prototype worked. Sterling: "it's on the same page of the app... people just
 * want to see it when they pull up the app." Making the portfolio a separate
 * URL turned looking at your collection into navigation, which is not what a
 * collector opening the app wants.
 */
export default function Page() {
  return <Home />;
}
