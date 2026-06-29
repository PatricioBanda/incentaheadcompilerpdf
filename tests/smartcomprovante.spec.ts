import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:3000'

test.describe('SmartComprovante smoke tests', () => {
  test('homepage returns 200 and HTML', async ({ request }) => {
    const res = await request.get(BASE + '/')
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('<!DOCTYPE html')
  })

  test('smartcomprovante page renders app shell', async ({ page }) => {
    await page.goto('/smartcomprovante')
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 })
  })

  test('download list API returns { entries: [] }', async ({ request }) => {
    const res = await request.get(BASE + '/api/smartcomprovante/download?type=list')
    expect(res.status()).toBe(200)
    const json = await res.json() as unknown
    expect(json).toHaveProperty('entries')
    expect(Array.isArray((json as { entries: unknown }).entries)).toBe(true)
  })

  test('projects API does not 500', async ({ request }) => {
    const res = await request.get(BASE + '/api/smartcomprovante/projects')
    expect(res.status()).toBeLessThan(500)
  })

  test('no JS errors on smartcomprovante page', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/smartcomprovante')
    await page.waitForLoadState('networkidle')
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0)
  })
})
