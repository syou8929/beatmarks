import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("beatmarks", { ready: true });
