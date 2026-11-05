import "../shared/bootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { startExtensionRuntime } from "./runtime";
import "../../../web/src/styles.css";
import "./client.css";

void startExtensionRuntime().then(()=>createRoot(document.getElementById("root")!).render(<StrictMode><HashRouter><App/></HashRouter></StrictMode>));
