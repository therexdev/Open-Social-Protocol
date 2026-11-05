import "../shared/bootstrap";
import { createRoot } from "react-dom/client";
import { EmbeddedPost } from "./Post";
import "./style.css";

createRoot(document.getElementById("root")!).render(<EmbeddedPost />);
