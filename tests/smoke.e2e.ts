import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('mission control Run view opens and renders the landmark', async ({ app, screen }) => {
  await app.open('/control/');
  await expect(screen.getByRole('banner')).toContainText('Mission control');
  await expect(screen.getByRole('region', { name: 'The running card' })).toBeVisible();
});
