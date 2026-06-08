import { create } from "zustand";

export interface DeployServerConfig {
  host: string;
  port?: number;
  username?: string;
  privateKeyPem?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface DesktopConfig {
  cursorApiKey?: string;
  deployServers?: DeployServerConfig[];
}

interface UiStore {
  config: DesktopConfig | null;
  setConfig: (c: DesktopConfig | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  config: null,
  setConfig: (c) => set({ config: c }),
}));
