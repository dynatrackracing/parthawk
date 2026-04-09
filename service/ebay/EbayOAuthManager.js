'use strict';

const { log } = require('../lib/logger');
const axios = require('axios').default;

/**
 * EbayOAuthManager — Manages OAuth 2.0 User Access Tokens for eBay RESTful APIs.
 *
 * Handles automatic token refresh using the long-lived refresh token.
 * The refresh token (18-month lifespan) is stored in EBAY_REFRESH_TOKEN.
 * Access tokens (2-hour lifespan) are cached in memory and auto-refreshed.
 *
 * Required env vars:
 *   EBAY_CLIENT_ID      — eBay App ID (from developer portal)
 *   EBAY_CLIENT_SECRET   — eBay Cert ID / shared secret
 *   EBAY_REFRESH_TOKEN   — Long-lived refresh token from consent flow
 *
 * Usage:
 *   const oauthManager = require('./EbayOAuthManager');
 *   const token = await oauthManager.getToken();  // Always fresh
 */

const TOKEN_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token';

// Scopes granted during consent flow (must match exactly).
// IMPORTANT: Only request scopes the refresh token was originally minted with.
// Adding scopes here that weren't in the original consent flow will cause
// "scope is invalid or exceeds the scope granted" errors on every refresh.
// The Post-Order API (returns) is a "traditional" API that works with the
// base api_scope — no special return scope needed.
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
].join(' ');

class EbayOAuthManager {
  constructor() {
    this.log = log.child({ class: 'EbayOAuthManager' }, true);
    this._accessToken = null;
    this._expiresAt = 0; // Unix ms timestamp
    this._refreshing = null; // Deduplication promise
  }

  /**
   * Returns true if all required env vars are configured.
   */
  isConfigured() {
    return !!(
      process.env.EBAY_CLIENT_ID &&
      process.env.EBAY_CLIENT_SECRET &&
      process.env.EBAY_REFRESH_TOKEN
    );
  }

  /**
   * Get a valid access token. Refreshes automatically if expired or expiring soon.
   * Returns null if not configured or if refresh fails (caller should fall back to legacy token).
   */
  async getToken() {
    if (!this.isConfigured()) {
      return null;
    }

    // Return cached token if still valid (with 5-minute buffer)
    const bufferMs = 5 * 60 * 1000;
    if (this._accessToken && Date.now() < this._expiresAt - bufferMs) {
      return this._accessToken;
    }

    // Deduplicate concurrent refresh calls
    if (this._refreshing) {
      try {
        return await this._refreshing;
      } catch (err) {
        return null;
      }
    }

    this._refreshing = this._refresh();
    try {
      const token = await this._refreshing;
      return token;
    } catch (err) {
      // Refresh failed — return null so callers fall back to legacy token
      this.log.warn({ err: err.message }, 'getToken: refresh failed, returning null for fallback');
      return null;
    } finally {
      this._refreshing = null;
    }
  }

  /**
   * Force a token refresh. Returns { success, expiresIn, error }.
   * Used by the startup health check and /health/oauth endpoint.
   */
  async healthCheck() {
    if (!this.isConfigured()) {
      const missing = [];
      if (!process.env.EBAY_CLIENT_ID) missing.push('EBAY_CLIENT_ID');
      if (!process.env.EBAY_CLIENT_SECRET) missing.push('EBAY_CLIENT_SECRET');
      if (!process.env.EBAY_REFRESH_TOKEN) missing.push('EBAY_REFRESH_TOKEN');
      return { success: false, error: `Missing env vars: ${missing.join(', ')}` };
    }

    try {
      await this._refresh();
      const expiresIn = Math.round((this._expiresAt - Date.now()) / 1000);
      return { success: true, expiresIn, expiresAt: new Date(this._expiresAt).toISOString() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Build the consent authorization URL that includes all SCOPES.
   * Visit this URL in a browser, authorize, then exchange the code for a refresh token.
   */
  getAuthorizationUrl(ruName) {
    const clientId = process.env.EBAY_CLIENT_ID;
    if (!clientId) return { error: 'EBAY_CLIENT_ID not set' };
    if (!ruName) return { error: 'ruName (redirect URI name) is required' };

    const encodedScopes = encodeURIComponent(SCOPES);
    const url = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(ruName)}&scope=${encodedScopes}`;
    return { url, scopes: SCOPES.split(' ') };
  }

  /**
   * Get current token status without making any API calls.
   */
  getStatus() {
    if (!this.isConfigured()) {
      return { configured: false, hasToken: false };
    }
    const now = Date.now();
    const hasToken = !!this._accessToken;
    const expiresIn = hasToken ? Math.round((this._expiresAt - now) / 1000) : 0;
    const isValid = hasToken && now < this._expiresAt - 5 * 60 * 1000;
    return {
      configured: true,
      hasToken,
      isValid,
      expiresIn,
      expiresAt: hasToken ? new Date(this._expiresAt).toISOString() : null,
    };
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async _refresh() {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    const refreshToken = process.env.EBAY_REFRESH_TOKEN;

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    this.log.info('Refreshing eBay OAuth user access token');

    try {
      const response = await axios.post(TOKEN_ENDPOINT, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: SCOPES,
      }).toString(), {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      });

      const { access_token, expires_in } = response.data;
      if (!access_token) {
        throw new Error('No access_token in response');
      }

      this._accessToken = access_token;
      this._expiresAt = Date.now() + (expires_in * 1000);

      const expiresMin = Math.round(expires_in / 60);
      this.log.info({ expiresIn: expiresMin }, `OAuth token refreshed, expires in ${expiresMin} minutes`);

      return access_token;
    } catch (err) {
      const status = err.response?.status;
      const errorBody = err.response?.data;
      const errorMsg = errorBody?.error_description || errorBody?.error || err.message;

      this.log.error({ status, error: errorMsg }, 'OAuth token refresh failed');

      // Clear cached token on refresh failure
      this._accessToken = null;
      this._expiresAt = 0;

      throw new Error(`OAuth refresh failed (${status || 'network'}): ${errorMsg}`);
    }
  }
}

// Singleton — shared across the app
module.exports = new EbayOAuthManager();
