import "../shared/bootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "./Sidebar";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sidebar />
  </StrictMode>,
);
