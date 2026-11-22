import { connection } from 'next/server';
import { readRunViewSnapshot } from '../lib/run-source.js';
import RunView from './components/RunView.jsx';

export default async function RunViewPage() {
  await connection();
  const initialData = await readRunViewSnapshot();
  return <RunView initialData={initialData} />;
}
