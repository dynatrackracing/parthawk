'use strict';

const router = require('express-promise-router')();
const axios = require('axios');
const cheerio = require('cheerio');

const EBAY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

/**
 * GET /api/listing-tool/ebay-lookup?url=https://www.ebay.com/itm/12345
 * Fetches a single eBay listing and returns structured data.
 */
router.get('/ebay-lookup', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes('ebay.com/itm/')) {
    return res.status(400).json({ success: false, error: 'Valid eBay listing URL required (ebay.com/itm/...)' });
  }

  try {
    const { data: html } = await axios.get(url, { headers: EBAY_HEADERS, timeout: 15000 });
    const $ = cheerio.load(html);

    // Title
    const title = $('h1.x-item-title__mainTitle span').text().trim()
      || $('h1[itemprop="name"]').text().trim()
      || $('h1').first().text().trim();

    // Price
    const priceText = $('.x-price-primary span').first().text().trim()
      || $('[itemprop="price"]').attr('content')
      || '';
    const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || null;

    // Item ID from URL
    const itemIdMatch = url.match(/\/itm\/(\d+)/);
    const itemId = itemIdMatch ? itemIdMatch[1] : null;

    // Seller
    const seller = $('a.ux-seller-section__item--link span').first().text().trim()
      || $('[data-testid="str-title"] a').text().trim()
      || '';

    // Condition
    const condition = $('.x-item-condition-value span').first().text().trim()
      || $('[data-testid="item-condition-value"]').text().trim()
      || '';

    // Item specifics
    const itemSpecifics = {};
    $('.ux-labels-values').each((_, el) => {
      const label = $(el).find('.ux-labels-values__labels').text().trim().replace(/:$/, '');
      const value = $(el).find('.ux-labels-values__values').text().trim();
      if (label && value && label !== 'Condition') itemSpecifics[label] = value;
    });
    // Fallback
    if (Object.keys(itemSpecifics).length === 0) {
      $('[data-testid="ux-labels-values"]').each((_, el) => {
        const label = $(el).find('[data-testid="ux-labels-values-label"]').text().trim().replace(/:$/, '');
        const value = $(el).find('[data-testid="ux-labels-values-value"]').text().trim();
        if (label && value) itemSpecifics[label] = value;
      });
    }

    const partNumber = itemSpecifics['Manufacturer Part Number']
      || itemSpecifics['OE/OEM Part Number']
      || itemSpecifics['OEM Part Number']
      || null;

    // Compatibility table
    const compatibility = [];
    $('table tr').each((i, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 3) {
        const year = $(cells[0]).text().trim();
        const make = $(cells[1]).text().trim();
        const model = $(cells[2]).text().trim();
        if (!year || year === 'Year' || !make) return;
        compatibility.push({
          year, make, model,
          trim: cells.length > 3 ? $(cells[3]).text().trim() : '',
          engine: cells.length > 4 ? $(cells[4]).text().trim() : '',
        });
      }
    });

    // Description from iframe
    let description = '';
    const descFrame = $('#desc_ifr').attr('src') || $('iframe[id*="desc"]').attr('src');
    if (descFrame) {
      try {
        const descUrl = descFrame.startsWith('http') ? descFrame : `https:${descFrame}`;
        const { data: descHtml } = await axios.get(descUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $d = cheerio.load(descHtml);
        description = $d('body').text().trim().substring(0, 2000);
      } catch (e) { /* optional */ }
    }

    res.json({
      success: true,
      data: {
        title, price, itemId, condition, seller, partNumber,
        compatibility: compatibility.slice(0, 50),
        itemSpecifics,
        description: description.substring(0, 2000),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: `Failed to fetch listing: ${err.message}` });
  }
});

module.exports = router;
