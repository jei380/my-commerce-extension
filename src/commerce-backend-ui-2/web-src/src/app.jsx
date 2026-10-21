import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "../../../../app.commerce.config.js";
import { MainPage } from "./pages/main-page.jsx";

createExtensionApp({
  menu: <MainPage />,
  metadata: {
    extensionId: config.metadata.id
  },
});
