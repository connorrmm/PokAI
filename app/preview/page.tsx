import { redirect } from 'next/navigation';

/** '/preview' was the rebuild's temporary home. It is now the main app at '/',
 *  so this redirects rather than 404s -- links and habits both still work. */
export default function Preview() {
  redirect('/');
}
