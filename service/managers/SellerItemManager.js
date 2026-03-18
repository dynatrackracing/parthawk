'use strict'

const { log } = require('../lib/logger');
const FindingsAPI = require('../ebay/FindingsAPI');
const BrowseAPI = require('../ebay/BrowseAPI');
const Promise = require('bluebird');
const {v4: uuidv4 } = require('uuid');
const Item = require('../models/Item');


const ECU_CATEGORY_CODE = 35596;
const EBAY_MOTORS_CATEGORY_CODE = 3600;
const PARTS_ACCESSORIES_CATEGORIES_CODE = 6028;

const categoryCodeList = [ECU_CATEGORY_CODE];

class SellerItemManager {
  constructor() {
    this.log = log.child({ class: 'FindingsAPI' }, true);
    this.findingsApi = new FindingsAPI();
    this.browseAPI = new BrowseAPI();
  }

  async getItemsForSellers(sellers) {
    await Promise.mapSeries(sellers, async (seller) => {
      await this.getItemsForSeller({ seller });
    });
  }


  async getItemsForSeller({ seller }){
    if (!seller) {
      this.log.error('Seller is undefined!');
      return;
    }
    this.log.info({ seller }, 'Getting items for seller');

    // loop through the codes, make all the calls, store items in the db, and update the cache
    await Promise.mapSeries(categoryCodeList, async (categoryId) => {
      this.log.info({categoryId}, 'Looking up category id');
      // make initial call
      let response = await this.browseAPI.makeRequest({ categoryId, seller: seller.name});

      this.log.info(`Response for ${categoryId} has a total of ${response.total} items`);

      await this.processResponse(response, seller);

      // continue to fetch until next is null
      // ebay is retarded and will keep fetching something?? even after the offset > total
      while(response.next && response.next != null && response.offset < response.total) {
        this.log.info({ nextUrl: response.next }, 'Response has next url, continuing to fetch');
        response = await this.browseAPI.makeRequestUrl({ url: response.next});
        await this.processResponse(response, seller.name );
      }
    });
  }

  async processResponse(response, seller) {
    const { itemSummaries } = response;
    await Promise.mapSeries(itemSummaries, async (item) => {
      const toInsert = {
        id: uuidv4(),
        ebayId: item.legacyItemId,
        price: item.price.value,
        title: item.title,
        categoryId: item.categories[0].categoryId,
        categoryTitle: item.categories[0].categoryName,
        seller: item.seller.username,
        pictureUrl: item.image.imageUrl,
        processed: false,
        isRepair:  seller.isRepair
      }

      this.log.trace({ toInsert });

      // drop duplicates - it is cheaper to try to insert everything rather than get the missing parts only
      // dont bother caching anything, use the power of the db and the pipeline here
      const response = await Item.query().insert(toInsert).onConflict('ebayId').ignore();
      this.log.trace({ response }, 'response from inserting item into database');
    })
  }


  // async getItemsForSeller({ seller }) {
  //   if (!seller) {
  //     this.log.error('Seller is undefined!');
  //     return;
  //   }
  //   this.log.info({ seller }, 'Getting items for seller');

  //   let paginationInput = {
  //     entriesPerPage: 100,
  //     pageNumber: 1,
  //   }

  //   // make initial request to determine the total number of items the seller has
  //   let response = await this.findingsApi.makeRequest({
  //     sellerName: seller.name,
  //     paginationOptions: paginationInput,
  //   });



  //   const { findItemsAdvancedResponse } = response;
  //   const { paginationOutput, searchResult } = findItemsAdvancedResponse;

  //   // verify we're actually getting the right page
  //   if (paginationOutput[0].pageNumber[0] != paginationInput.pageNumber ) {
  //     this.log.warn({ requestedPageNumber: paginationInput.pageNumber, receivedPageNumber: paginationOutput[0].pageNumber[0] }, 'Potential page number mismatch! Continuing');
  //   }

  //   const totalEntries = findItemsAdvancedResponse.paginationOutput[0].totalEntries[0];
  //   this.log.info({ totalEntries }, 'total entries found');

  //   const totalPages = Math.round(totalEntries / paginationInput.entriesPerPage);
  //   this.log.info({ totalPages }, 'Calculated total pages to grab')

  //   // process the current page since we already have it
  //   this.log.debug('Processing the first page');
  //   await this.processPage({
  //     result: searchResult[0].item,
  //     seller,
  //   });

  //   // now load everything up
  //   for (let i = 2; i <= totalPages; i += 1) {

  //     const ret = await this.findingsApi.makeRequest({
  //       sellerName: seller.name,
  //       paginationOptions: {
  //         entriesPerPage: 100,
  //         pageNumber: i,
  //       }
  //     });
  //     this.log.info(`Preparing to process page ${i} after getting info`)
  //     await this.processPage({
  //       result: ret.findItemsAdvancedResponse.searchResult[0].item,
  //       seller,
  //     });
  //   }

  // }

  // /**
  //  * 
  //  * @param {Item[]} result - Array of items for this seller
  //  * @param {String} seller - the name of the seller
  //  */
  // async processPage({ result, seller }) {
  //   this.log.debug({ size: result.length, seller }, 'Received array for seller');
  //   await Promise.mapSeries(result, async (item) => {
  //     const toInsert = {
  //       id: uuidv4(),
  //       ebayId: item.itemId[0],
  //       price:  parseFloat(item.sellingStatus[0].currentPrice[0]._),
  //       title: item.title[0],
  //       categoryId: item.primaryCategory[0].categoryId[0],
  //       categoryTitle: item.primaryCategory[0].categoryName[0],
  //       seller: seller.name,
  //       pictureUrl: item.galleryURL[0],
  //       processed: false,
  //       isRepair: seller.isRepair,
  //     };

  //     this.log.trace({ toInsert }, 'Preparing to insert item into db');

  //     // drop duplicates - it is cheaper to try to insert everything rather than get the missing parts only
  //     const response = await Item.query().insert(toInsert).onConflict('ebayId').ignore();
  //     this.log.trace({ response }, 'response from inserting item into database');
  //   });
  // }
}

module.exports = SellerItemManager;