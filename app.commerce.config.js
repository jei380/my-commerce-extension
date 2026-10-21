const { defineConfig } = require("@adobe/aio-commerce-lib-app/config");

module.exports = defineConfig({
  metadata: {
    id: "my-commerce-extension",
    displayName: "My Commerce Extension",
    version: "1.0.0",
    description:
      "A custom Adobe Commerce application. Fill description for your app.",
  },
  adminUi: {
    menu: {
      description: "Displays enriched order data in Commerce Admin.",
      id: "order_enrichment_admin",
      label: "Order Enrichment",
      pageTitle: "Enriched Orders Dashboard - Updated",
    },
  },
  eventing: {},
});
