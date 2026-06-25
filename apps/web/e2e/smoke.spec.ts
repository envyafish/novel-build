import { test, expect } from '@playwright/test'

test('backend health + project create round-trip', async ({ request }) => {
  const health = await request.get('http://127.0.0.1:4317/health')
  expect(health.ok()).toBeTruthy()
  const create = await request.post('http://127.0.0.1:4317/api/projects', {
    data: { name: 'E2E', slug: 'e2e' },
  })
  expect(create.ok()).toBeTruthy()
})
