import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./index.css";
import { getInitialTheme } from "./components/ThemeToggle";

const initialTheme = getInitialTheme();
document.documentElement.classList.add(initialTheme);
document.documentElement.style.colorScheme = initialTheme;
createRoot(document.getElementById("root")!).render(<App />);
