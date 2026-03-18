'use strict';

/**
 * Test scraping a single item - debug version
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function testScrape() {
  const title = 'Nissan Sentra 2002 2.5L ECU ECM PCM Engine Control Module JA56R42';
  const yourPrice = 269.91;

  console.log(`\nTesting: ${title}`);
  console.log(`Your price: $${yourPrice}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Test with Dodge Dakota query that should have 52 results
  const searchQuery = 'dodge dakota 4.7l 2005 ecu ecm';
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

  console.log(`Search URL: ${url}\n`);

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    // Wait for items to load - try multiple selectors
    try {
      await page.waitForSelector('.s-item__title, .str-item-card, [data-testid="listing-item"]', { timeout: 10000 });
    } catch (e) {
      console.log('No items found with primary selectors, waiting longer...');
    }
    await page.waitForTimeout(3000);
    await page.keyboard.press('End');
    await page.waitForTimeout(2000);

    // Take screenshot for debugging
    await page.screenshot({ path: '/tmp/ebay-search.png', fullPage: false });
    console.log('Screenshot saved to /tmp/ebay-search.png');

    // Get page info
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    // Check for results count
    const resultInfo = await page.evaluate(() => {
      const countEl = document.querySelector('.srp-controls__count-heading');
      const noResults = document.querySelector('.srp-save-null-search__heading');
      return {
        count: countEl ? countEl.textContent?.trim() : null,
        noResults: noResults ? noResults.textContent?.trim() : null,
      };
    });
    console.log(`Results info:`, resultInfo);

    // Debug: Find elements containing price text
    const debug = await page.evaluate(() => {
      // Find all elements containing $ prices
      const priceEls = [];
      document.querySelectorAll('*').forEach(el => {
        const text = el.textContent || '';
        if (text.match(/^\$\d+\.\d{2}$/) && el.children.length === 0) {
          priceEls.push({
            tag: el.tagName,
            class: el.className,
            parent: el.parentElement?.className,
            grandparent: el.parentElement?.parentElement?.className,
          });
        }
      });
      return {
        price_elements: priceEls.slice(0, 5),
        ul_count: document.querySelectorAll('ul').length,
        li_count: document.querySelectorAll('li').length,
      };
    });
    console.log('Debug price elements:', JSON.stringify(debug, null, 2));

    // Try to extract sold items - using new eBay card structure
    const soldItems = await page.evaluate(() => {
      const results = [];
      // eBay now uses su-card-container for items
      const listings = document.querySelectorAll('[class*="su-card-container"], [class*="s-card"]');

      // If no cards found, try finding by price elements and walking up
      if (listings.length === 0) {
        const priceEls = document.querySelectorAll('.s-card__price');
        priceEls.forEach((priceEl, idx) => {
          // Walk up to find the card container
          let card = priceEl.closest('[class*="su-card"]') || priceEl.closest('li') || priceEl.parentElement?.parentElement?.parentElement;
          if (card) {
            const titleEl = card.querySelector('[class*="s-card__title"], a[href*="ebay.com/itm"]');
            const soldDateEl = card.querySelector('[class*="positive"], [class*="POSITIVE"]');

            const title = titleEl?.textContent?.trim() || '';
            const price = priceEl?.textContent?.trim() || '';
            const soldDate = soldDateEl?.textContent?.trim() || '';

            // Filter out noise: "View similar", duplicates, non-sold items
            if (title && price && !title.includes('View similar') && soldDate.includes('Sold')) {
              results.push({ idx, title: title.substring(0, 70), price, soldDate });
            }
          }
        });
        return results;
      }

      listings.forEach((item, idx) => {
        const titleEl = item.querySelector('[class*="s-card__title"], a');
        const priceEl = item.querySelector('.s-card__price, [class*="price"]');
        const soldDateEl = item.querySelector('[class*="positive"]');

        if (titleEl && priceEl) {
          const title = titleEl.textContent?.trim();
          const price = priceEl.textContent?.trim();
          const soldDate = soldDateEl?.textContent?.trim() || '';

          // Filter: must have sold date, no "View similar", no "Shop on eBay"
          if (title && price.includes('$') && soldDate.includes('Sold') &&
              !title.includes('View similar') && title !== 'Shop on eBay') {
            results.push({
              idx,
              title: title.substring(0, 70),
              price,
              soldDate
            });
          }
        }
      });

      // Deduplicate by title
      const seen = new Set();
      const unique = results.filter(item => {
        const key = item.title + item.price;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return unique;
    });

    console.log(`\nFound ${soldItems.length} items:`);
    soldItems.slice(0, 10).forEach(item => {
      console.log(`  ${item.price} - ${item.soldDate || 'no date'} - ${item.title}...`);
    });

    // Parse prices for analysis
    const prices = soldItems
      .map(i => parseFloat(i.price.replace(/[^0-9.]/g, '')))
      .filter(p => !isNaN(p) && p > 0);

    if (prices.length > 0) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const sorted = [...prices].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      console.log(`\n=== MARKET ANALYSIS ===`);
      console.log(`Sold items found: ${prices.length}`);
      console.log(`Price range: $${min} - $${max}`);
      console.log(`Average: $${avg.toFixed(2)}`);
      console.log(`Median: $${median.toFixed(2)}`);
      console.log(`\nYour price: $${yourPrice}`);
      console.log(`vs Median: ${yourPrice > median ? '+' : ''}${((yourPrice - median) / median * 100).toFixed(1)}%`);

      if (yourPrice > median * 1.3) {
        console.log(`\nRecommendation: OVERPRICED - Consider lowering to ~$${median.toFixed(2)}`);
      } else if (yourPrice < median * 0.8) {
        console.log(`\nRecommendation: UNDERPRICED - Could raise to ~$${median.toFixed(2)}`);
      } else {
        console.log(`\nRecommendation: MARKET PRICE - Priced competitively`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

testScrape().then(() => console.log('\nDone!')).catch(console.error);
