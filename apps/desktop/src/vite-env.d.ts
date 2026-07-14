/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getLanApiBaseUrl: (port?: number) => string;
    printReceipt: (
      url: string,
      options?: {
        widthMm?: number;
        marginLeftMm?: number;
        marginRightMm?: number;
        silent?: boolean;
        deviceName?: string;
      }
    ) => Promise<boolean>;
    listPrinters?: () => Promise<
      Array<{
        name: string;
        displayName?: string;
        description?: string;
        status?: number;
        isDefault?: boolean;
      }>
    >;
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
