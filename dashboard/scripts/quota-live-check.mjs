// One live check of the quota readers: what each provider says, beside what the reader made
// of it, at the same moment. Prints numbers only: no token, key or raw body.
import { SUBSCRIPTIONS, defaultCredentials, readSubscriptions } from '../lib/quota/index.mjs';

const raw = {
  chatgpt: body => ({ primary_window: body?.rate_limit?.primary_window, secondary_window: body?.rate_limit?.secondary_window }),
  claude: body => ({ five_hour: body?.five_hour, seven_day: body?.seven_day }),
  commandcode: body => ({ fiveHour: body?.windowLimits?.fiveHour, weekly: body?.windowLimits?.weekly }),
};

const credentials = defaultCredentials();

async function rawReading(entry) {
  try {
    const auth = await entry.auth({ fetch: globalThis.fetch, credentials });
    const response = await auth.fetch(entry.url, { headers: auth.headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { status: response.status };
    return { status: response.status, ...raw[entry.id](await response.json()) };
  } catch (error) {
    return { status: 'failed', name: error?.name };
  }
}

const at = new Date().toISOString();
const readings = await readSubscriptions({ credentials });
const raws = await Promise.all(SUBSCRIPTIONS.map(rawReading));

for (const [index, entry] of SUBSCRIPTIONS.entries()) {
  console.log(`\n${entry.id} (${entry.name}) — ${at}`);
  console.log('  provider says:', JSON.stringify(raws[index]));
  const reading = readings[index];
  if (reading.status !== 'fresh') {
    console.log('  reader says: unknown');
    continue;
  }
  for (const window of reading.windows) {
    console.log(`  reader says: ${window.window} ${window.percentLeft}% left, resets ${window.resetsAt ? new Date(window.resetsAt).toISOString() : 'no reset date yet'}`);
  }
}
