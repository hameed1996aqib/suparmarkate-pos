/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getLanApiBaseUrl: (port?: number) => string;
    printReceipt: (
      url: string,
      options?: {
        widthMm?: number;
      }
    ) => Promise<boolean>;
    minimizeWindow?: () => Promise<void>;
    toggleMaximizeWindow?: () => Promise<boolean>;
    isWindowMaximized?: () => Promise<boolean>;
    toggleFullScreenWindow?: () => Promise<boolean>;
    isWindowFullScreen?: () => Promise<boolean>;
    closeWindow?: () => Promise<void>;
  };
  desktopApp?: {
    windowControls?: {
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      toggleFullScreen: () => Promise<boolean>;
      isFullScreen: () => Promise<boolean>;
      close: () => Promise<void>;
    };
  };
}
