const { test, expect } = require('@playwright/test');

test.describe('Sales Intelligence Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass auth by setting localStorage before page loads
    await page.addInitScript(() => {
      window.localStorage.setItem('DISABLE_AUTH', 'true');
    });

    // Navigate to the Sales Intelligence page
    await page.goto('/intelligence');

    // Wait for the page to load
    await page.waitForTimeout(1000);

    // If redirected to login, reload to pick up the localStorage
    if (page.url().includes('/login')) {
      await page.goto('/intelligence');
    }

    // Wait for the page to load
    await expect(page.locator('h1')).toContainText('Sales Intelligence', { timeout: 15000 });
  });

  test('dashboard loads with stats', async ({ page }) => {
    // Verify the page header exists
    await expect(page.locator('h1')).toContainText('Sales Intelligence');

    // Verify the 4 cards are visible (use more specific selectors)
    await expect(page.locator('h2:has-text("Price Check")')).toBeVisible();
    await expect(page.locator('h2:has-text("Stale Inventory")')).toBeVisible();
    await expect(page.locator('h2:has-text("What to Pull")')).toBeVisible();
    await expect(page.locator('h2:has-text("Opportunities")')).toBeVisible();

    // Verify stats loaded (should show actual numbers, not 0)
    await expect(page.locator('text=active listings')).toBeVisible();
    await expect(page.locator('text=sales imported')).toBeVisible();
  });

  test('Price Check card navigates and shows listings', async ({ page }) => {
    // Click the Price Check card (the link with h2 Price Check inside)
    await page.locator('a:has(h2:has-text("Price Check"))').click();

    // Verify we navigated to the price check page
    await expect(page).toHaveURL(/.*\/intelligence\/price-check/);

    // Verify the page header
    await expect(page.locator('h1')).toContainText('Price Check', { timeout: 15000 });

    // Wait for data to load (spinner should disappear)
    await expect(page.locator('.animate-spin')).toBeHidden({ timeout: 30000 });

    // Verify the summary cards exist
    await expect(page.locator('text=Total Listings')).toBeVisible();
    await expect(page.locator('text=Unchecked')).toBeVisible();
    await expect(page.locator('text=Overpriced')).toBeVisible();
    await expect(page.locator('text=Underpriced')).toBeVisible();

    // Verify the table exists
    await expect(page.locator('table')).toBeVisible();

    // Verify table headers are present
    await expect(page.locator('th:has-text("Item")')).toBeVisible();
    await expect(page.locator('th:has-text("Your Price")')).toBeVisible();
    await expect(page.locator('th:has-text("Days Listed")')).toBeVisible();

    // Verify action buttons exist
    await expect(page.locator('button:has-text("Check All Prices")')).toBeVisible();
    await expect(page.locator('button:has-text("Sync from eBay")')).toBeVisible();
  });

  test('Stale Inventory card navigates and shows items', async ({ page }) => {
    // Click the Stale Inventory card
    await page.locator('a:has(h2:has-text("Stale Inventory"))').click();

    // Verify we navigated to the stale inventory page
    await expect(page).toHaveURL(/.*\/intelligence\/stale-inventory/);

    // Verify the page header
    await expect(page.locator('h1')).toContainText('Stale Inventory', { timeout: 15000 });

    // Wait for data to load
    await expect(page.locator('.animate-spin')).toBeHidden({ timeout: 30000 });

    // Verify summary cards exist
    await expect(page.locator('text=Stale Items')).toBeVisible();
    await expect(page.locator('text=Value at Risk')).toBeVisible();
    await expect(page.locator('text=Potential Recovery')).toBeVisible();
    await expect(page.locator('text=Threshold')).toBeVisible();

    // Verify the threshold slider exists
    await expect(page.locator('input[type="range"]')).toBeVisible();

    // Verify recommendation summary cards (SCRAP, DEEP DISCOUNT, etc.)
    await expect(page.locator('p.text-xs.font-medium:has-text("SCRAP")')).toBeVisible();
    await expect(page.locator('p.text-xs.font-medium:has-text("HOLD")')).toBeVisible();

    // Verify the table exists
    await expect(page.locator('table')).toBeVisible();

    // Verify table headers
    await expect(page.locator('th:has-text("Item")')).toBeVisible();
    await expect(page.locator('th:has-text("Days")')).toBeVisible();
    await expect(page.locator('th:has-text("Market Demand")')).toBeVisible();
    await expect(page.locator('th:has-text("Recommendation")')).toBeVisible();

    // Verify the legend/explanation section exists
    await expect(page.locator('text=Understanding Recommendations')).toBeVisible();
  });

  test('Your Sales link navigates and shows sales history', async ({ page }) => {
    // Click the "View sales history" link
    await page.locator('a:has-text("View sales history")').click();

    // Verify we navigated to the your sales page
    await expect(page).toHaveURL(/.*\/intelligence\/your-sales/);

    // Verify the page header
    await expect(page.locator('h1')).toContainText('Your Sales History', { timeout: 15000 });

    // Wait for data to load
    await expect(page.locator('.animate-spin')).toBeHidden({ timeout: 30000 });

    // Verify summary cards exist with data
    await expect(page.locator('text=Total Sales')).toBeVisible();
    await expect(page.locator('text=Total Revenue')).toBeVisible();
    await expect(page.locator('text=Avg Sale Price')).toBeVisible();

    // Verify the table exists
    await expect(page.locator('table')).toBeVisible();

    // Verify table headers
    await expect(page.locator('th:has-text("Item")')).toBeVisible();
    await expect(page.locator('th:has-text("Sale Price")')).toBeVisible();
    await expect(page.locator('th:has-text("Sold Date")')).toBeVisible();
    await expect(page.locator('th:has-text("Buyer")')).toBeVisible();

    // Verify at least one sale row exists
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
  });
});
