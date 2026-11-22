import { readRunViewSnapshot } from '../lib/run-view-server.mjs';
import { RunView } from './run-view.jsx';

// The run moves while the page is open, so every visit is read fresh.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const snapshot = await readRunViewSnapshot();
  return <RunView initialSnapshot={snapshot} />;
}
