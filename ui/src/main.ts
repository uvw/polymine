import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { api, hasShell } from "./lib/api";
import { resolveLanguage, setLanguage } from "./lib/i18n";
import { installLogForwarding } from "./lib/log";

if (hasShell()) installLogForwarding();

const target = document.getElementById("app");
if (!target) throw new Error("missing #app element");

// The language has to be set before anything renders a string.
const saved = hasShell() ? await api.getSettings().catch(() => null) : null;
setLanguage(resolveLanguage(saved?.language ?? "system"));

export default mount(App, { target });
