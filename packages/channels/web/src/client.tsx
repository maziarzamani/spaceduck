import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(<App />);
