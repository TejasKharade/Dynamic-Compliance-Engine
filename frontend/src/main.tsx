import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import { getInitialTheme } from "./components/ThemeToggle";

const initialTheme = getInitialTheme();
document.documentElement.classList.add(initialTheme);
document.documentElement.style.colorScheme = initialTheme;
createRoot(document.getElementById("root")!).render(<App />);
