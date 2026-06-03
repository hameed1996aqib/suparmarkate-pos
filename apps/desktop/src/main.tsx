import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./app/app-error-boundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works as a normal LAN web client if registration fails.
    });
  });
}
