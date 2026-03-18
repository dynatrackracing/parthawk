'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function checkItemPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Go directly to a completed listing
  const url = 'https://www.ebay.com/itm/236552475815';
  console.log('Checking completed item:', url);

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Dump ALL script content looking for dates
  const allScriptData = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('script').forEach((script, idx) => {
      const text = script.textContent || '';

      // Look for any date-like patterns in JSON
      if (text.includes('Time') || text.includes('Date') || text.includes('2025') || text.includes('2026')) {
        // Extract potential date fields
        const patterns = [
          /"startTime":\s*"([^"]+)"/,
          /"endTime":\s*"([^"]+)"/,
          /"listingStartDate":\s*"([^"]+)"/,
          /"listingEndDate":\s*"([^"]+)"/,
          /"soldDate":\s*"([^"]+)"/,
          /"creationDate":\s*"([^"]+)"/,
          /"listingDate":\s*"([^"]+)"/,
        ];

        patterns.forEach(pattern => {
          const match = text.match(pattern);
          if (match) {
            results.push(`${pattern.source.split('"')[1]}: ${match[1]}`);
          }
        });
      }
    });
    return [...new Set(results)]; // Dedupe
  });

  console.log('\n=== Date fields found in page scripts ===');
  if (allScriptData.length > 0) {
    allScriptData.forEach(d => console.log('  ', d));
  } else {
    console.log('  No date fields found in scripts');
  }

  // Also check meta tags and data attributes
  const metaData = await page.evaluate(() => {
    const results = [];

    // Check meta tags
    document.querySelectorAll('meta').forEach(meta => {
      const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
      const content = meta.getAttribute('content') || '';
      if (name.toLowerCase().includes('date') || name.toLowerCase().includes('time')) {
        results.push(`meta[${name}]: ${content}`);
      }
    });

    // Check for itemprops
    document.querySelectorAll('[itemprop]').forEach(el => {
      const prop = el.getAttribute('itemprop');
      if (prop && (prop.includes('date') || prop.includes('time') || prop.includes('Date'))) {
        results.push(`itemprop[${prop}]: ${el.textContent?.trim() || el.getAttribute('content')}`);
      }
    });

    return results;
  });

  if (metaData.length > 0) {
    console.log('\n=== Meta/structured data ===');
    metaData.forEach(d => console.log('  ', d));
  }

  await browser.close();
}

checkItemPage().catch(console.error);
