import "@spaceduck/ui/styles.css";
import { createRoot } from "react-dom/client";
import { App } from "@spaceduck/ui";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(<App />);
