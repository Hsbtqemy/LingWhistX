import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  applyStoredTheme,
  initThemeColorMetaSync,
  initThemeStorageSync,
} from "./theme/applyStoredTheme";

applyStoredTheme();
initThemeStorageSync();
initThemeColorMetaSync();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
