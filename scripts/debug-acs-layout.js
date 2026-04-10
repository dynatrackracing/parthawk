'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const URL = 'https://www.ebay.com/sch/i.html?_ssn=autocircuitsolutions&_sacat=0&LH_Sold=1&LH_Complete=1&_ipg=60&_pgn=1';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  console.log('Navigating to:', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for results to render — try several possible selectors
  try {
    await page.waitForSelector('ul.srp-results, .srp-river-results, li.s-item, li.s-card, [class*="s-card"]', { timeout: 15000 });
  } catch (e) {
    console.log('WARNING: No known result selectors found within 15s, proceeding anyway');
  }
  await page.waitForTimeout(3000);

  const results = await page.evaluate(() => {
    const out = {};

    // a-e: selector counts
    out.a_ulSrpLi = document.querySelectorAll('ul.srp-results > li').length;
    out.b_liSItem = document.querySelectorAll('li.s-item').length;
    out.c_liSCard = document.querySelectorAll('li.s-card').length;
    out.d_suCardContainer = document.querySelectorAll('.su-card-container').length;
    out.e_dataViewportSCard = document.querySelectorAll('[data-viewport] .s-card').length;

    // f: walk ancestors of first .s-card__link
    const firstLink = document.querySelector('.s-card__link');
    if (firstLink) {
      const ancestors = [];
      let el = firstLink;
      for (let i = 0; i < 5; i++) {
        el = el.parentElement;
        if (!el) break;
        ancestors.push(`${el.tagName}.${el.className.replace(/\s+/g, '.')}`);
      }
      out.f_ancestors = ancestors;
    } else {
      out.f_ancestors = 'NO .s-card__link FOUND';

      // Fallback: look for any link-like elements in potential card containers
      const anyCard = document.querySelector('[class*="s-card"]');
      if (anyCard) {
        out.f_fallback_card_tag = anyCard.tagName;
        out.f_fallback_card_class = anyCard.className;
        const ancestors = [];
        let el = anyCard;
        for (let i = 0; i < 5; i++) {
          el = el.parentElement;
          if (!el) break;
          ancestors.push(`${el.tagName}.${el.className.replace(/\s+/g, '.')}`);
        }
        out.f_fallback_ancestors = ancestors;
      } else {
        out.f_fallback = 'NO [class*="s-card"] elements at all';
      }
    }

    // g: outerHTML of the first card's closest container
    const firstCard = document.querySelector('.s-card');
    if (firstCard) {
      const container = firstCard.closest('li') || firstCard.parentElement;
      out.g_containerHTML = (container ? container.outerHTML : firstCard.outerHTML).substring(0, 600);
    } else {
      // Fallback: try to get whatever container holds results
      const srp = document.querySelector('ul.srp-results');
      if (srp && srp.children.length > 0) {
        out.g_containerHTML = srp.children[0].outerHTML.substring(0, 600);
      } else {
        // Last resort: grab the main content area
        const main = document.querySelector('#srp-river-results') ||
                     document.querySelector('.srp-river-results') ||
                     document.querySelector('[id*="srp"]');
        out.g_containerHTML = main ? main.innerHTML.substring(0, 600) : 'NO SRP CONTAINER FOUND';
        out.g_note = 'No .s-card found, showing main container';

        // Also dump all unique class names containing "card" or "item" or "srp"
        const allEls = document.querySelectorAll('*');
        const classSet = new Set();
        allEls.forEach(el => {
          const cls = el.className;
          if (typeof cls === 'string' && (cls.includes('card') || cls.includes('item') || cls.includes('srp'))) {
            classSet.add(`${el.tagName}.${cls.trim().split(/\s+/).join('.')}`);
          }
        });
        out.g_relevant_classes = Array.from(classSet).slice(0, 40);
      }
    }

    // Bonus: page title and result count text
    out.pageTitle = document.title;
    const countEl = document.querySelector('.srp-controls__count-heading, h1.srp-controls__count-heading, .s-answer-region-header');
    out.resultCountText = countEl ? countEl.textContent.trim() : 'no count element found';

    return out;
  });

  console.log('\n=== RESULTS ===\n');
  console.log('a) ul.srp-results > li count:', results.a_ulSrpLi);
  console.log('b) li.s-item count:', results.b_liSItem);
  console.log('c) li.s-card count:', results.c_liSCard);
  console.log('d) .su-card-container count:', results.d_suCardContainer);
  console.log('e) [data-viewport] .s-card count:', results.e_dataViewportSCard);
  console.log('\nf) Ancestors of first .s-card__link:');
  if (Array.isArray(results.f_ancestors)) {
    results.f_ancestors.forEach((a, i) => console.log(`   ${i}: ${a}`));
  } else {
    console.log('  ', results.f_ancestors);
    if (results.f_fallback_card_tag) {
      console.log('   Fallback card found:', results.f_fallback_card_tag + '.' + results.f_fallback_card_class);
      console.log('   Fallback ancestors:');
      (results.f_fallback_ancestors || []).forEach((a, i) => console.log(`     ${i}: ${a}`));
    }
    if (results.f_fallback) console.log('  ', results.f_fallback);
  }
  console.log('\ng) First card container outerHTML (600 chars):');
  console.log(results.g_containerHTML);
  if (results.g_note) console.log('   NOTE:', results.g_note);
  if (results.g_relevant_classes) {
    console.log('\n   Relevant class names on page:');
    results.g_relevant_classes.forEach(c => console.log('    ', c));
  }
  console.log('\nPage title:', results.pageTitle);
  console.log('Result count text:', results.resultCountText);

  // === PER-ITEM TRACE: first 3 li.s-card elements ===
  console.log('\n=== PER-ITEM TRACE (first 3 li.s-card) ===\n');

  const itemTrace = await page.evaluate(() => {
    const cards = document.querySelectorAll('li.s-card');
    const rows = [];

    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const el = cards[i];
      const row = {};

      // a) link
      row.a_link = el.querySelector('.s-card__link')?.href || null;

      // b) title (new)
      row.b_title_new = el.querySelector('.s-card__title')?.textContent?.trim() || null;

      // c) title (old)
      row.c_title_old = el.querySelector('.s-item__title')?.textContent?.trim() || null;

      // d) price (new)
      row.d_price_new = el.querySelector('.s-card__price')?.textContent?.trim() || null;

      // e) price (old)
      row.e_price_old = el.querySelector('.s-item__price')?.textContent?.trim() || null;

      // f) condition/subtitle
      row.f_subtitle = el.querySelector('.s-card__subtitle')?.textContent?.trim() || null;

      // g) sold date area (new) — .s-card__caption
      row.g_caption_new = el.querySelector('.s-card__caption')?.textContent?.trim() || null;

      // h) sold date area (old) — .s-item__caption
      row.h_caption_old = el.querySelector('.s-item__caption')?.textContent?.trim() || null;

      // i) image URL
      const imgContainer = el.querySelector('.s-card__image');
      const imgEl = imgContainer ? imgContainer.querySelector('img') : el.querySelector('img');
      row.i_image = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || null;

      // j) data-listingid from the li
      row.j_listingId = el.getAttribute('data-listingid') || null;

      // k) count of ANY old-style .s-item__* class elements
      row.k_old_class_count = el.querySelectorAll('[class*="s-item__"]').length;

      // l) count of ALL new-style .s-card__* class elements
      row.l_new_class_count = el.querySelectorAll('[class*="s-card__"]').length;

      // bonus: full textContent of the card (to find where "Sold" date text lives)
      const fullText = el.textContent || '';
      const soldMatch = fullText.match(/(Sold\s+[A-Za-z0-9,\/\s]+)/);
      row.m_sold_text_match = soldMatch ? soldMatch[1].trim() : null;

      // bonus: the scraper's href regex check
      const href = row.a_link || '';
      const idMatch = href.match(/\/itm\/(\d+)/);
      row.n_parsed_itemId = idMatch ? idMatch[1] : null;
      row.o_is_dummy_id = row.n_parsed_itemId === '123456';

      // bonus: what the scraper's price parser would produce
      const priceText = row.d_price_new || row.e_price_old || '';
      const priceSplit = priceText.includes(' to ') ? priceText.split(' to ')[0] : priceText;
      row.p_parsed_price = parseFloat(priceSplit.replace(/[^0-9.]/g, '')) || 0;

      rows.push(row);
    }

    return rows;
  });

  for (let i = 0; i < itemTrace.length; i++) {
    const r = itemTrace[i];
    console.log(`--- Card ${i + 1} ---`);
    console.log(`  a) link:            ${r.a_link}`);
    console.log(`  b) title (new):     ${r.b_title_new}`);
    console.log(`  c) title (old):     ${r.c_title_old}`);
    console.log(`  d) price (new):     ${r.d_price_new}`);
    console.log(`  e) price (old):     ${r.e_price_old}`);
    console.log(`  f) subtitle:        ${r.f_subtitle}`);
    console.log(`  g) caption (new):   ${r.g_caption_new}`);
    console.log(`  h) caption (old):   ${r.h_caption_old}`);
    console.log(`  i) image:           ${r.i_image}`);
    console.log(`  j) data-listingid:  ${r.j_listingId}`);
    console.log(`  k) old s-item__ ct: ${r.k_old_class_count}`);
    console.log(`  l) new s-card__ ct: ${r.l_new_class_count}`);
    console.log(`  m) "Sold" text:     ${r.m_sold_text_match}`);
    console.log(`  n) parsed itemId:   ${r.n_parsed_itemId}`);
    console.log(`  o) is dummy 123456: ${r.o_is_dummy_id}`);
    console.log(`  p) parsed price:    ${r.p_parsed_price}`);
    console.log('');
  }

  await browser.close();
  console.log('Done.');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
