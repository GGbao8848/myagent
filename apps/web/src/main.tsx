import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Toaster richColors position="top-right" />
  </>
);
