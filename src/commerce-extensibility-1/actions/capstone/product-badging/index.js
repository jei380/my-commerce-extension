const { Core } = require('@adobe/aio-sdk');
const stateLib = require('@adobe/aio-lib-state');

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_SCOPES =
  'openid,AdobeID,email,profile,additional_info.roles,additional_info.projectedProductContext,commerce.accs';
const CONFIG_STATE_KEY = 'badge-config-v1';

const DEFAULT_TIERS = [
  { percentage: 20, badgeText: 'Deep Discount!' },
  { percentage: 30, badgeText: 'Super Saver!' },
  { percentage: 40, badgeText: 'Hot Deal!' },
];

/**
 * Adobe I/O often stores IMS_OAUTH_S2S_SCOPES in .env as a JSON array string. IMS expects a
 * space-delimited scope parameter (RFC 6749). Also normalizes comma-separated lists.
 */
function normalizeScopeTokens (scopeStr) {
  return String(scopeStr)
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');
}

function resolveImsScopeParam (raw, defaultScopes) {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    return normalizeScopeTokens(defaultScopes);
  }
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean).join(' ');
  }
  const s = String(raw).trim();
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((t) => String(t).trim()).filter(Boolean).join(' ');
      }
    } catch {
      /* fall through */
    }
  }
  return normalizeScopeTokens(s);
}

function normalizeTiers (tiers) {
  if (!Array.isArray(tiers)) {
    return DEFAULT_TIERS;
  }

  const normalized = tiers
    .map((tier) => ({
      percentage: Number(tier?.percentage),
      badgeText: String(tier?.badgeText || '').trim(),
    }))
    .filter((tier) => Number.isFinite(tier.percentage) && tier.percentage > 0 && tier.percentage <= 100 && tier.badgeText)
    .sort((a, b) => a.percentage - b.percentage);

  return normalized.length ? normalized : DEFAULT_TIERS;
}

async function getBadgeTiersFromState (logger) {
  try {
    const state = await stateLib.init();
    const stored = await state.get(CONFIG_STATE_KEY);

    if (!stored?.value) {
      return DEFAULT_TIERS;
    }

    const parsed = JSON.parse(stored.value);
    return normalizeTiers(parsed?.tiers);
  } catch (error) {
    logger.warn(`Falling back to default badge tiers: ${error.message}`);
    return DEFAULT_TIERS;
  }
}

function calculateDiscountPercent (listPrice, salePrice) {
  if (!Number.isFinite(listPrice) || !Number.isFinite(salePrice) || listPrice <= 0 || salePrice >= listPrice) {
    return 0;
  }
  return ((listPrice - salePrice) / listPrice) * 100;
}

function resolveBadgeForDiscount (discountPercent, tiers) {
  let matchedTier = null;
  let matchedTierRank = null;

  tiers.forEach((tier, index) => {
    if (discountPercent >= tier.percentage) {
      matchedTier = tier;
      matchedTierRank = index + 1;
    }
  });

  return {
    matchedTier,
    matchedTierRank,
  };
}

let cachedToken = null;
let cachedExpiryMs = 0;

async function getImsAccessToken (params) {
  if (cachedToken && Date.now() < cachedExpiryMs - 60_000) {
    return cachedToken;
  }
  const body = new URLSearchParams({
    client_id: params.IMS_OAUTH_S2S_CLIENT_ID,
    client_secret: params.IMS_OAUTH_S2S_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: resolveImsScopeParam(params.IMS_OAUTH_S2S_SCOPES, DEFAULT_SCOPES),
  });
  const res = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IMS token request failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  cachedExpiryMs = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function main (params) {
  const logger = Core.Logger('product-badge', {
    level: params.LOG_LEVEL || 'info',
  });

  try {
    const { sku } = params;
    if (!sku) {
      return {
        statusCode: 400,
        body: { error: 'Missing required parameter: sku' },
      };
    }

    logger.info(`Fetching product data for SKU: ${sku}`);

    const baseUrl = params.COMMERCE_API_BASE_URL.replace(/\/$/, '');
    const accessToken = await getImsAccessToken(params);

    const productUrl = `${baseUrl}/V1/products/${encodeURIComponent(sku)}`;

    const response = await fetch(productUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-api-key': params.IMS_OAUTH_S2S_CLIENT_ID,
        'x-gw-ims-org-id': params.IMS_OAUTH_S2S_ORG_ID,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error(`Commerce API returned ${response.status}`);
      return {
        statusCode: response.status,
        body: { error: `Commerce API error: ${response.statusText}` },
      };
    }

    const product = await response.json();
    logger.info(JSON.stringify(product, null, 2));

  const badgeTiers = await getBadgeTiersFromState(logger);

    const specialPriceAttr = product.custom_attributes?.find(
        attr => attr.attribute_code === "special_price"
    );
    
    const salePrice = specialPriceAttr
        ? parseFloat(specialPriceAttr.value)
        : null;

    const listPrice = Number(product.price);
    const discountPercent = calculateDiscountPercent(listPrice, salePrice);
  const { matchedTier, matchedTierRank } = resolveBadgeForDiscount(discountPercent, badgeTiers);
  const deepDiscountBadge = matchedTier ? matchedTier.badgeText : null;

    const productBadge = {
      sku: product.sku,
      name: product.name,
      price: product.price,
      salesPrice: salePrice,
      discountPercent: Number(discountPercent.toFixed(2)),
  tierRank: matchedTierRank,
      tierThreshold: matchedTier ? matchedTier.percentage : null,
      deepDiscountBadge: deepDiscountBadge,
      enrichedAt: new Date().toISOString(),
    };

    logger.info(`Successfully added badge to product: ${sku}`);

    return {
      statusCode: 200,
      body: productBadge,
    };
  } catch (error) {
    logger.error('Action failed:', error.message);
    return {
      statusCode: 500,
      body: { error: 'Internal server error' },
    };
  }
}
exports.main = main;