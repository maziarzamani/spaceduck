import "@spaceduck/ui/styles.css";
import { createRoot } from "react-dom/client";
import { App, DictationPill } from "@spaceduck/ui";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const params = new URLSearchParams(window.location.search);
const isDictationWindow = params.get("window") === "dictation";

createRoot(root).render(isDictationWindow ? <DictationPill /> : <App />);
