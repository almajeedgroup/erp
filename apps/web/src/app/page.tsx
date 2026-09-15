import { redirect } from 'next/navigation';
import { getAccessToken } from '@/lib/session';

/**
 * The root simply routes: signed in goes to the dashboard, otherwise to login.
 * Keeping this decision on the server means an unauthenticated visitor never
 * downloads the application shell at all.
 */
export default async function IndexPage() {
  const token = await getAccessToken();
  redirect(token ? '/dashboard' : '/login');
}
