import "../shared/bootstrap";
import { createRoot } from "react-dom/client";
import { EmbeddedPost } from "./Post";
import "../../../web/src/styles.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(<EmbeddedPost />);
