import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";

const saved = localStorage.getItem("pi-studio.theme");
document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
