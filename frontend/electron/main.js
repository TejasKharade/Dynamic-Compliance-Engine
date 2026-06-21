// frontend/electron/main.js
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const isDev = process.env.NODE_ENV === "development";

let mainWindow;
let backendProcess;

// ── Start FastAPI backend ──────────────────────────────────────────────────
function startBackend() {
  // In dev: use uvicorn directly
  // In prod: use the bundled python executable
  const isPackaged = app.isPackaged;

  let backendCmd, backendArgs, backendCwd;

  if (isPackaged) {
    // Bundled app — python is included in resources
    const resourcesPath = process.resourcesPath;
    backendCmd = path.join(resourcesPath, "backend", "main.exe"); // Windows
    backendArgs = [];
    backendCwd = path.join(resourcesPath, "backend");
  } else {
    // Development — use system Python
    backendCmd = "python";
    backendArgs = ["-m", "uvicorn", "src.api.main:app", "--host", "127.0.0.1", "--port", "8000"];
    backendCwd = path.join(__dirname, "../../"); // project root
  }

  backendProcess = spawn(backendCmd, backendArgs, {
    cwd: backendCwd,
    env: { ...process.env },
    windowsHide: true, // hide the terminal window on Windows
  });

  backendProcess.stdout.on("data", (d) => console.log("[backend]", d.toString()));
  backendProcess.stderr.on("data", (d) => console.error("[backend]", d.toString()));
  backendProcess.on("close", (code) => console.log("[backend] exited with code", code));
}

// ── Create the app window ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "ComplianceIQ — Dynamic Compliance Engine",
    // titleBarStyle: "hiddenInset", // Uncomment for macOS native look
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Optional: custom icon
    // icon: path.join(__dirname, "../public/icon.png"),
  });

  if (isDev) {
    // Dev: load Vite dev server
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    // Prod: load built index.html
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Open external links in the system browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startBackend();

  // Wait a moment for the backend to start before loading the window
  setTimeout(createWindow, isDev ? 2000 : 1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Kill the backend when the app closes
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== "darwin") app.quit();
});