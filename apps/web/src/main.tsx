import { startPwa } from "./pwa/state";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { startAutoLock, useVault } from "./vault/store";
import { startSettingsSync, useSettings } from "./stores/settings";
import "./styles.css";

startAutoLock(useVault);
startSettingsSync(useSettings);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

startPwa();
