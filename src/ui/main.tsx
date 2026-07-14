import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHostBridge } from "./services/HostBridge";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Keystone Webview root element was not found.");

createRoot(root).render(<App bridge={createHostBridge()}/>);
