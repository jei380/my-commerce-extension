const { defineConfig } = require("@adobe/aio-commerce-lib-app/config");

module.exports = defineConfig({
  metadata: {
    id: "my-commerce-extension",
    displayName: "My Commerce Extension",
    version: "1.0.0",
    description:
      "A custom Adobe Commerce application. Fill description for your app.",
  },
  eventing: {
    commerce: [
      {
        provider: {
          label: "Commerce Events Provider",
          description: "A description for your Commerce Events provider.",
        },
        events: [
          {
            name: "plugin.sample_event",
            fields: [{ name: "*" }],
            label: "Sample Event",
            description: "Use case description for the event.",
            runtimeActions: ["my-package/handle-sample-event"],
          },
        ],
      },
    ],
  },
});
