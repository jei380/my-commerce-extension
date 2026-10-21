const { Core } = require('@adobe/aio-sdk');
const stateLib = require('@adobe/aio-lib-state');

async function main (params) {
  const logger = Core.Logger('get-enriched-orders', {
    level: params.LOG_LEVEL || 'info',
  });

  try {
    const state = await stateLib.init();

    const orderKeys = params.orderIds
      ? params.orderIds.split(',').map((id) => `order-${id.trim()}`)
      : [];

    if (orderKeys.length === 0) {
      const knownOrders = await state.get('known-order-ids');
      if (knownOrders && knownOrders.value) {
        const ids = JSON.parse(knownOrders.value);
        orderKeys.push(...ids.map((id) => `order-${id}`));
      }
    }

    const orders = [];
    for (const key of orderKeys) {
      const result = await state.get(key);
      if (result && result.value) {
        orders.push(JSON.parse(result.value));
      }
    }

    orders.sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));

    const summary = {
      totalOrders: orders.length,
      totalRevenue: orders.reduce(
        (sum, o) => sum + parseFloat(o.grandTotal || 0),
        0
      ),
      tierBreakdown: orders.reduce((acc, o) => {
        const tier = o.enrichment?.orderTier || 'unknown';
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      }, {}),
      highValueCount: orders.filter(
        (o) => o.enrichment?.isHighValue
      ).length,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: { orders, summary },
    };
  } catch (error) {
    logger.error('Failed to fetch enriched orders:', error.message);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: { error: 'Failed to fetch enriched orders' },
    };
  }
}

exports.main = main;