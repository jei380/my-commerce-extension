import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import { useState } from "react";
import { Button } from "@react-spectrum/s2";
import "@react-spectrum/s2/page.css";

import config from "../../../../app.commerce.config.js";
import { MainPage } from "./pages/main-page.jsx";
import { BadgeConfigPage } from "./pages/badge-config-page.jsx";

function AdminShell() {
  const [activePage, setActivePage] = useState("orders");

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <Button
          variant={activePage === "orders" ? "primary" : "secondary"}
          onPress={() => setActivePage("orders")}
        >
          Order Enrichment
        </Button>
        <Button
          variant={activePage === "badges" ? "primary" : "secondary"}
          onPress={() => setActivePage("badges")}
        >
          Badge Configuration
        </Button>
      </div>

      {activePage === "orders" ? <MainPage /> : <BadgeConfigPage />}
    </div>
  );
}

createExtensionApp({
  menu: <AdminShell />,
  metadata: {
    extensionId: config.metadata.id,
  },
});
