import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

type Screen = "connect" | "scanner";
type CameraMode = "connect" | "product" | null;
type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
};

type PosConnection = {
  sessionId: string;
  apiBaseUrl: string;
  webSocketUrl: string;
  scanHttpUrl: string;
};

type CartItem = {
  key: string;
  productId: string;
  productName: string;
  barcode: string;
  unitName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  expiryDate?: string | null;
};

const COLORS = {
  bg: "#080E1E",
  bg2: "#0B1020",
  card: "#10182D",
  card2: "#151F3A",
  stroke: "#273555",
  blue: "#4DA3FF",
  purple: "#706BFF",
  cyan: "#43E8FF",
  text: "#F6F8FF",
  textSoft: "#A8B3CC",
  success: "#22C55E",
  error: "#EF4444",
  warning: "#F59E0B"
};

function trimEndSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function money(value: number) {
  return new Intl.NumberFormat("fa-AF", {
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}


function vibrateSuccess() {
  if (Platform.OS === "android") {
    Vibration.vibrate(80);
    return;
  }

  Vibration.vibrate();
}
function getButtonTitle(cameraMode: CameraMode, target: "connect" | "product") {
  if (cameraMode !== target) {
    return target === "connect" ? "Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  QR Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž" : "Ã˜Â´Ã˜Â±Ã™Ë†Ã˜Â¹ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã˜Â¨Ã˜Â§Ã˜Â±ÃšÂ©Ã™Ë†Ã˜Â¯";
  }

  return target === "connect" ? "Ã˜Â¨Ã˜Â³Ã˜ÂªÃ™â€  Ã˜Â¯Ã™Ë†Ã˜Â±Ã˜Â¨Ã›Å’Ã™â€ " : "Ã˜ÂªÃ™Ë†Ã™â€šÃ™Â Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€ ";
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();

  const [screen, setScreen] = useState<Screen>("connect");
  const [cameraMode, setCameraMode] = useState<CameraMode>(null);

  const [connection, setConnection] = useState<PosConnection | null>(null);
  const connectionRef = useRef<PosConnection | null>(null);

  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [statusText, setStatusText] = useState("Ã˜Â¨Ã˜Â±Ã˜Â§Ã›Å’ Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž QR Ã˜ÂµÃ™â€ Ã˜Â¯Ã™Ë†Ã™â€š Ã™ÂÃ˜Â±Ã™Ë†Ã˜Â´ Ã˜Â±Ã˜Â§ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  ÃšÂ©Ã™â€ Ã›Å’Ã˜Â¯");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeVisibleCodesRef = useRef<Set<string>>(new Set());
  const lastSeenCodesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = makeId();

    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2200);
  }, []);

  const closeSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setIsSocketConnected(false);
  }, []);

  const addScannedProductToCart = useCallback(
    (payload: any) => {
      if (!payload?.product) return;

      const product = payload.product;
      const totalStock = Number(payload.totalStock || 0);
      const recommendedLot = payload.recommendedLot || null;

      if (!recommendedLot || totalStock <= 0) {
        setStatusText(`Ã™â€¦Ã™Ë†Ã˜Â¬Ã™Ë†Ã˜Â¯Ã›Å’ Ã™â€ Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â¯: ${product.name}`);
        showToast(`Ã™â€¦Ã™Ë†Ã˜Â¬Ã™Ë†Ã˜Â¯Ã›Å’ Ã™â€ Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â¯: ${product.name}`, "error");
        return;
      }

      const defaultSaleUnit =
        payload.defaultSaleUnit ||
        (product.units || []).find((item: any) => item.isDefaultSale) ||
        (product.units || [])[0] ||
        null;

      const unitId = defaultSaleUnit?.unitId || product.baseUnitId || "unit";
      const unitName =
        defaultSaleUnit?.unit?.shortName ||
        defaultSaleUnit?.unit?.name ||
        product.baseUnit?.shortName ||
        product.baseUnit?.name ||
        "Ã™Ë†Ã˜Â§Ã˜Â­Ã˜Â¯";

      const unitPrice = Number(defaultSaleUnit?.salePrice || 0);
      const key = `${product.id}:${unitId}`;

      setCart((prev) => {
        const exists = prev.find((item) => item.key === key);

        if (exists) {
          return prev.map((item) => {
            if (item.key !== key) return item;

            const quantity = item.quantity + 1;

            return {
              ...item,
              quantity,
              lineTotal: quantity * item.unitPrice
            };
          });
        }

        return [
          {
            key,
            productId: product.id,
            productName: product.name,
            barcode: product.barcode || "",
            unitName,
            unitPrice,
            quantity: 1,
            lineTotal: unitPrice,
            expiryDate: recommendedLot?.expiryDate || null
          },
          ...prev
        ];
      });

      setStatusText(`Ã˜Â§Ã˜Â¶Ã˜Â§Ã™ÂÃ™â€¡ Ã˜Â´Ã˜Â¯: ${product.name}`);
      showToast(`${product.name} Ã˜Â¨Ã™â€¡ Ã˜Â³Ã˜Â¨Ã˜Â¯ Ã˜Â§Ã˜Â¶Ã˜Â§Ã™ÂÃ™â€¡ Ã˜Â´Ã˜Â¯`, "success");
    },
    [showToast]
  );

  const connectWebSocket = useCallback(
    (nextConnection: PosConnection) => {
      closeSocket();

      setStatusText("Ã˜Â¯Ã˜Â± Ã˜Â­Ã˜Â§Ã™â€ž Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â¨Ã™â€¡ Ã˜ÂµÃ™â€ Ã˜Â¯Ã™Ë†Ã™â€š Ã™ÂÃ˜Â±Ã™Ë†Ã˜Â´...");

      const ws = new WebSocket(nextConnection.webSocketUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsSocketConnected(true);
        setStatusText("Ã™Ë†Ã˜ÂµÃ™â€ž Ã˜Â´Ã˜Â¯ Ã˜Â­Ã˜Â§Ã™â€žÃ˜Â§ Ã˜Â¨Ã˜Â§Ã˜Â±ÃšÂ©Ã™Ë†Ã˜Â¯ Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€ž Ã˜Â±Ã˜Â§ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  ÃšÂ©Ã™â€ Ã›Å’Ã˜Â¯");
        showToast("Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã™â€¦Ã™Ë†Ã™ÂÃ™â€š Ã˜Â´Ã˜Â¯", "success");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "CONNECTED") {
            setIsSocketConnected(true);
            return;
          }

          if (message.type === "BARCODE_SCANNED") {
            addScannedProductToCart(message.payload);
            return;
          }

          if (message.type === "SCAN_ERROR") {
            const msg = message.payload?.message || "Ã˜Â®Ã˜Â·Ã˜Â§ Ã˜Â¯Ã˜Â± Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€ž";
            setStatusText(msg);
            showToast(msg, "error");
          }
        } catch {
          // ignore invalid JSON
        }
      };

      ws.onerror = () => {
        setIsSocketConnected(false);
        setStatusText("Ã˜Â®Ã˜Â·Ã˜Â§ Ã˜Â¯Ã˜Â± Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â¨Ã™â€¡ Ã˜ÂµÃ™â€ Ã˜Â¯Ã™Ë†Ã™â€š Ã™ÂÃ˜Â±Ã™Ë†Ã˜Â´");
      };

      ws.onclose = () => {
        setIsSocketConnected(false);
        setStatusText("Ã˜Â§Ã˜Â±Ã˜ÂªÃ˜Â¨Ã˜Â§Ã˜Â· Ã™â€šÃ˜Â·Ã˜Â¹ Ã˜Â´Ã˜Â¯ Ã˜ÂªÃ™â€žÃ˜Â§Ã˜Â´ Ã˜Â¨Ã˜Â±Ã˜Â§Ã›Å’ Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â¯Ã™Ë†Ã˜Â¨Ã˜Â§Ã˜Â±Ã™â€¡...");

        if (connectionRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            if (connectionRef.current) {
              connectWebSocket(connectionRef.current);
            }
          }, 1800);
        }
      };
    },
    [addScannedProductToCart, closeSocket, showToast]
  );

  const disconnectSession = useCallback(() => {
    closeSocket();
    setConnection(null);
    setScreen("connect");
    setCameraMode(null);
    setCart([]);
    setStatusText("Ã˜Â¨Ã˜Â±Ã˜Â§Ã›Å’ Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž QR Ã˜ÂµÃ™â€ Ã˜Â¯Ã™Ë†Ã™â€š Ã™ÂÃ˜Â±Ã™Ë†Ã˜Â´ Ã˜Â±Ã˜Â§ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  ÃšÂ©Ã™â€ Ã›Å’Ã˜Â¯");
    activeVisibleCodesRef.current.clear();
    lastSeenCodesRef.current.clear();
    showToast("Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã™â€šÃ˜Â·Ã˜Â¹ Ã˜Â´Ã˜Â¯", "info");
  }, [closeSocket, showToast]);

  const parseConnectionPayload = useCallback((raw: string): PosConnection | null => {
    try {
      const parsed = JSON.parse(raw);

      if (!parsed?.sessionId || !parsed?.apiBaseUrl) {
        return null;
      }

      const apiBaseUrl = trimEndSlash(String(parsed.apiBaseUrl));
      const sessionId = String(parsed.sessionId);
      const url = new URL(apiBaseUrl);
      const wsProtocol = url.protocol === "https:" ? "wss" : "ws";

      return {
        sessionId,
        apiBaseUrl,
        webSocketUrl:
          parsed.webSocketUrl ||
          `${wsProtocol}://${url.hostname}:4001?sessionId=${encodeURIComponent(
            sessionId
          )}&clientType=mobile`,
        scanHttpUrl: parsed.scanHttpUrl || `${apiBaseUrl}/api/pos/scan`
      };
    } catch {
      return null;
    }
  }, []);

  const handleConnectionQr = useCallback(
    (raw: string) => {
      const nextConnection = parseConnectionPayload(raw);

      if (!nextConnection) {
        showToast("QR Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã™â€¦Ã˜Â¹Ã˜ÂªÃ˜Â¨Ã˜Â± Ã™â€ Ã›Å’Ã˜Â³Ã˜Âª", "error");
        setStatusText("QR Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã™â€¦Ã˜Â¹Ã˜ÂªÃ˜Â¨Ã˜Â± Ã™â€ Ã›Å’Ã˜Â³Ã˜Âª");
        return;
      }

      setConnection(nextConnection);
      setStatusText("Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â¯Ã˜Â±Ã›Å’Ã˜Â§Ã™ÂÃ˜Âª Ã˜Â´Ã˜Â¯ Ã™Ë†Ã˜Â±Ã™Ë†Ã˜Â¯ Ã˜Â¨Ã™â€¡ Ã˜ÂµÃ™ÂÃ˜Â­Ã™â€¡ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€ž...");
      setCameraMode("product");
      setScreen("scanner");
      connectWebSocket(nextConnection);
      showToast("QR Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â®Ã™Ë†Ã˜Â§Ã™â€ Ã˜Â¯Ã™â€¡ Ã˜Â´Ã˜Â¯", "success");
    },
    [connectWebSocket, parseConnectionPayload, showToast]
  );

  const sendProductBarcode = useCallback(
    async (barcode: string) => {
      const current = connectionRef.current;

      if (!current) {
        showToast("Ã˜Â§Ã™Ë†Ã™â€ž Ã˜Â¨Ã˜Â§Ã›Å’Ã˜Â¯ Ã˜Â¨Ã™â€¡ Ã˜ÂµÃ™â€ Ã˜Â¯Ã™Ë†Ã™â€š Ã™ÂÃ˜Â±Ã™Ë†Ã˜Â´ Ã™Ë†Ã˜ÂµÃ™â€ž Ã˜Â´Ã™Ë†Ã›Å’Ã˜Â¯", "error");
        return;
      }

      try {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "SCAN_BARCODE",
              barcode
            })
          );

          return;
        }

        const response = await fetch(current.scanHttpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sessionId: current.sessionId,
            barcode
          })
        });

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json?.message || json?.error?.message || "Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã™â€ Ã˜Â§ÃšÂ©Ã˜Â§Ã™â€¦ Ã˜Â´Ã˜Â¯");
        }

        if (json?.data) {
          addScannedProductToCart(json.data);
        }
      } catch (error: any) {
        showToast(error?.message || "Ã˜Â®Ã˜Â·Ã˜Â§ Ã˜Â¯Ã˜Â± Ã˜Â§Ã˜Â±Ã˜Â³Ã˜Â§Ã™â€ž Ã˜Â¨Ã˜Â§Ã˜Â±ÃšÂ©Ã™Ë†Ã˜Â¯", "error");
        activeVisibleCodesRef.current.delete(barcode);
        lastSeenCodesRef.current.delete(barcode);
      }
    },
    [addScannedProductToCart, showToast]
  );

  const requestCameraAndToggle = useCallback(
    async (mode: "connect" | "product") => {
      if (!permission?.granted) {
        const res = await requestPermission();

        if (!res.granted) {
          Alert.alert("Ã˜Â§Ã˜Â¬Ã˜Â§Ã˜Â²Ã™â€¡ Ã™â€žÃ˜Â§Ã˜Â²Ã™â€¦ Ã˜Â§Ã˜Â³Ã˜Âª", "Ã˜Â¨Ã˜Â±Ã˜Â§Ã›Å’ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã˜Â§Ã˜Â¬Ã˜Â§Ã˜Â²Ã™â€¡ Camera Ã™â€žÃ˜Â§Ã˜Â²Ã™â€¦ Ã˜Â§Ã˜Â³Ã˜Âª");
          return;
        }
      }

      setCameraMode((prev) => (prev === mode ? null : mode));
    },
    [permission?.granted, requestPermission]
  );

  const handleBarcodeScanned = useCallback(
    async (event: any) => {
      const raw = String(event?.data || "").trim();

      if (!raw) return;

      if (cameraMode === "connect") {
        handleConnectionQr(raw);
        return;
      }

      if (cameraMode !== "product") return;

      const now = Date.now();
      lastSeenCodesRef.current.set(raw, now);

      if (activeVisibleCodesRef.current.has(raw)) {
        return;
      }

      activeVisibleCodesRef.current.add(raw);
      await sendProductBarcode(raw);
    },
    [cameraMode, handleConnectionQr, sendProductBarcode]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();

      for (const [code, lastSeen] of lastSeenCodesRef.current.entries()) {
        if (now - lastSeen > 1200) {
          lastSeenCodesRef.current.delete(code);
          activeVisibleCodesRef.current.delete(code);
        }
      }
    }, 400);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      closeSocket();
    };
  }, [closeSocket]);

  const itemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const totalPrice = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.lineTotal, 0);
  }, [cart]);

  const recentItems = useMemo(() => cart.slice(0, 6), [cart]);

  const clearCart = useCallback(() => {
    setCart([]);
    showToast("Ã˜Â³Ã˜Â¨Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¨Ã˜Â§Ã›Å’Ã™â€ž Ã™Â¾Ã˜Â§ÃšÂ© Ã˜Â´Ã˜Â¯", "info");
  }, [showToast]);

  const goToConnect = useCallback(() => {
    setScreen("connect");
    setCameraMode(null);
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.root}>
        {screen === "connect" ? (
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>MUHASEB POS</Text>
              <Text style={styles.title}>Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â¨Ã™â€¡ Ã˜ÂµÃ™â€ Ã˜Â¯Ã™Ë†Ã™â€š Ã™ÂÃ˜Â±Ã™Ë†Ã˜Â´</Text>
              <Text style={styles.subtitle}>
                QR Ã™â€¦Ã™Ë†Ã˜Â¬Ã™Ë†Ã˜Â¯ Ã˜Â¯Ã˜Â± Ã˜ÂµÃ™ÂÃ˜Â­Ã™â€¡ POS Ã˜Â¯Ã˜Â³ÃšÂ©Ã˜ÂªÃ˜Â§Ã™Â¾ Ã˜Â±Ã˜Â§ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  ÃšÂ©Ã™â€ Ã›Å’Ã˜Â¯ Ã˜ÂªÃ˜Â§ Ã™â€¦Ã™Ë†Ã˜Â¨Ã˜Â§Ã›Å’Ã™â€ž Ã˜Â¨Ã™â€¡ Ã˜Â³Ã›Å’Ã˜Â³Ã˜ÂªÃ™â€¦ Ã™Ë†Ã˜ÂµÃ™â€ž Ã˜Â´Ã™Ë†Ã˜Â¯.
              </Text>
            </View>

            <View style={styles.mainCard}>
              <View style={styles.glowIcon}>
                <Text style={styles.glowIconText}>QR</Text>
              </View>

              <Text style={styles.cardTitle}>Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â¨Ã˜Â§ QR Code</Text>
              <Text style={styles.cardText}>
                Ã˜Â±Ã™Ë†Ã˜Â´ Ã˜Â¯Ã˜Â³Ã˜ÂªÃ›Å’ Ã˜Â­Ã˜Â°Ã™Â Ã˜Â´Ã˜Â¯Ã™â€¡ Ã˜Â§Ã˜Â³Ã˜Âª. Ã˜Â¨Ã˜Â±Ã˜Â§Ã›Å’ Ã˜Â§Ã™â€¦Ã™â€ Ã›Å’Ã˜Âª Ã™Ë† Ã˜Â±Ã˜Â§Ã˜Â­Ã˜ÂªÃ›Å’ Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã™ÂÃ™â€šÃ˜Â· Ã˜Â¨Ã˜Â§ QR Ã˜Â§Ã™â€ Ã˜Â¬Ã˜Â§Ã™â€¦ Ã™â€¦Ã›Å’Ã˜Â´Ã™Ë†Ã˜Â¯.
              </Text>

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => requestCameraAndToggle("connect")}
              >
                <Text style={styles.primaryButtonText}>
                  {cameraMode === "connect" ? "Ã˜Â¨Ã˜Â³Ã˜ÂªÃ™â€  Ã˜Â¯Ã™Ë†Ã˜Â±Ã˜Â¨Ã›Å’Ã™â€ " : "Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  QR Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž"}
                </Text>
              </TouchableOpacity>

              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>Ã™Ë†Ã˜Â¶Ã˜Â¹Ã›Å’Ã˜Âª Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž</Text>
                <Text style={styles.statusValue}>{statusText}</Text>
              </View>
            </View>

            {cameraMode === "connect" ? (
              <View style={styles.cameraCard}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={handleBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: ["qr"]
                  }}
                />
                <View style={styles.cameraOverlay}>
                  <View style={styles.scanFrame} />
                  <Text style={styles.cameraHint}>QR Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž Ã˜Â±Ã˜Â§ Ã˜Â¯Ã˜Â§Ã˜Â®Ã™â€ž ÃšÂ©Ã˜Â§Ã˜Â¯Ã˜Â± Ã™â€šÃ˜Â±Ã˜Â§Ã˜Â± Ã˜Â¯Ã™â€¡Ã›Å’Ã˜Â¯</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.ghostButton} onPress={goToConnect}>
                <Text style={styles.ghostButtonText}>Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž</Text>
              </TouchableOpacity>

              <View
                style={[
                  styles.connectionPill,
                  { borderColor: isSocketConnected ? COLORS.success : COLORS.warning }
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: isSocketConnected ? COLORS.success : COLORS.warning }
                  ]}
                />
                <Text style={styles.connectionText}>
                  {isSocketConnected ? "Ã™Ë†Ã˜ÂµÃ™â€ž" : "Ã™â€šÃ˜Â·Ã˜Â¹"}
                </Text>
              </View>
            </View>

            <View style={styles.headerCompact}>
              <Text style={styles.eyebrow}>PRODUCT SCANNER</Text>
              <Text style={styles.titleSmall}>Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã˜Â¨Ã˜Â§Ã˜Â±ÃšÂ©Ã™Ë†Ã˜Â¯ Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€ž</Text>
              <Text style={styles.subtitle}>{statusText}</Text>
            </View>

            <View style={styles.cameraCardLarge}>
              {cameraMode === "product" ? (
                <CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={handleBarcodeScanned}
                  barcodeScannerSettings={{
                    barcodeTypes: [
                      "ean13",
                      "ean8",
                      "upc_a",
                      "upc_e",
                      "code128",
                      "code39",
                      "code93",
                      "codabar",
                      "itf14"
                    ]
                  }}
                />
              ) : (
                <View style={styles.cameraOff}>
                  <Text style={styles.cameraOffTitle}>Ã˜Â¯Ã™Ë†Ã˜Â±Ã˜Â¨Ã›Å’Ã™â€  Ã™â€¦Ã˜ÂªÃ™Ë†Ã™â€šÃ™Â Ã˜Â§Ã˜Â³Ã˜Âª</Text>
                  <Text style={styles.cameraOffText}>Ã˜Â¨Ã˜Â±Ã˜Â§Ã›Å’ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€ž Ã˜Â¯ÃšÂ©Ã™â€¦Ã™â€¡ Ã˜Â´Ã˜Â±Ã™Ë†Ã˜Â¹ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã˜Â±Ã˜Â§ Ã˜Â¨Ã˜Â²Ã™â€ Ã›Å’Ã˜Â¯.</Text>
                </View>
              )}

              <View style={styles.cameraOverlay}>
                <View style={styles.scanFrameWide} />
                <Text style={styles.cameraHint}>Ã˜Â¨Ã˜Â§Ã˜Â±ÃšÂ©Ã™Ë†Ã˜Â¯ Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€ž Ã˜Â±Ã˜Â§ Ã˜Â¯Ã˜Â§Ã˜Â®Ã™â€ž ÃšÂ©Ã˜Â§Ã˜Â¯Ã˜Â± Ã™â€ ÃšÂ¯Ã™â€¡ Ã˜Â¯Ã˜Â§Ã˜Â±Ã›Å’Ã˜Â¯</Text>
              </View>
            </View>

            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => requestCameraAndToggle("product")}
              >
                <Text style={styles.buttonText}>{getButtonTitle(cameraMode, "product")}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.redButton} onPress={disconnectSession}>
                <Text style={styles.buttonText}>Ã™â€šÃ˜Â·Ã˜Â¹ Ã˜Â§Ã˜ÂªÃ˜ÂµÃ˜Â§Ã™â€ž</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cartCard}>
              <View style={styles.cartHeader}>
                <View style={styles.rtlFlex}>
                  <Text style={styles.cardTitle}>Ã˜Â³Ã˜Â¨Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¨Ã˜Â§Ã›Å’Ã™â€ž</Text>
                  <Text style={styles.cardText}>Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€žÃ˜Â§Ã˜ÂªÃ›Å’ ÃšÂ©Ã™â€¡ Ã˜Â¨Ã˜Â§ Ã™â€¡Ã™â€¦Ã›Å’Ã™â€  Ã™â€¦Ã™Ë†Ã˜Â¨Ã˜Â§Ã›Å’Ã™â€ž Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã˜Â´Ã˜Â¯Ã™â€¡Ã˜Â§Ã™â€ Ã˜Â¯</Text>
                </View>

                <TouchableOpacity onPress={clearCart}>
                  <Text style={styles.clearText}>Ã™Â¾Ã˜Â§ÃšÂ©ÃšÂ©Ã˜Â±Ã˜Â¯Ã™â€ </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>Ã˜ÂªÃ˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯</Text>
                  <Text style={styles.summaryValue}>{itemsCount}</Text>
                </View>

                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>Ã™â€¦Ã˜Â¬Ã™â€¦Ã™Ë†Ã˜Â¹</Text>
                  <Text style={styles.summaryValue}>{money(totalPrice)}</Text>
                </View>
              </View>

              {recentItems.length ? (
                <View style={styles.itemsList}>
                  {recentItems.map((item) => (
                    <View style={styles.itemRow} key={item.key}>
                      <View style={styles.itemPriceBox}>
                        <Text style={styles.itemPrice}>{money(item.lineTotal)}</Text>
                      </View>

                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.productName}</Text>
                        <Text style={styles.itemMeta}>
                          {item.unitName}  {item.quantity}
                        </Text>
                      </View>

                      <View style={styles.itemIcon}>
                        <Text style={styles.itemIconText}></Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>Ã™â€¡Ã™â€ Ã™Ë†Ã˜Â² Ã™â€¦Ã˜Â­Ã˜ÂµÃ™Ë†Ã™â€žÃ›Å’ Ã˜Â§Ã˜Â³ÃšÂ©Ã™â€  Ã™â€ Ã˜Â´Ã˜Â¯Ã™â€¡ Ã˜Â§Ã˜Â³Ã˜Âª</Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}

        <View style={styles.toastWrap}>
          {toasts.map((toast) => (
            <View
              key={toast.id}
              style={[
                styles.toast,
                toast.type === "success"
                  ? { borderColor: COLORS.success }
                  : toast.type === "error"
                    ? { borderColor: COLORS.error }
                    : { borderColor: COLORS.blue }
              ]}
            >
              <Text style={styles.toastText}>{toast.message}</Text>
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0
  },
  root: {
    flex: 1,
    backgroundColor: COLORS.bg
  },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 140
  },
  rtlFlex: {
    flex: 1,
    alignItems: "flex-end"
  },
  header: {
    alignItems: "flex-end",
    marginBottom: 18
  },
  headerCompact: {
    alignItems: "flex-end",
    marginBottom: 14
  },
  eyebrow: {
    color: COLORS.cyan,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
    textAlign: "right",
    writingDirection: "rtl"
  },
  title: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8
  },
  titleSmall: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8
  },
  subtitle: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 23,
    textAlign: "right",
    writingDirection: "rtl"
  },
  mainCard: {
    backgroundColor: COLORS.card,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 20,
    marginBottom: 18,
    alignItems: "flex-end"
  },
  glowIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.blue,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16
  },
  glowIconText: {
    color: COLORS.blue,
    fontSize: 20,
    fontWeight: "900"
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8
  },
  cardText: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 14
  },
  primaryButton: {
    width: "100%",
    backgroundColor: COLORS.blue,
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900"
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: COLORS.purple,
    borderRadius: 20,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 7
  },
  redButton: {
    flex: 1,
    backgroundColor: "#2B1320",
    borderWidth: 1,
    borderColor: "#5F2338",
    borderRadius: 20,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 7
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900"
  },
  statusCard: {
    width: "100%",
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 20,
    padding: 14,
    alignItems: "flex-end"
  },
  statusLabel: {
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 6
  },
  statusValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl"
  },
  cameraCard: {
    height: 360,
    overflow: "hidden",
    borderRadius: 30,
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: COLORS.stroke,
    marginBottom: 18
  },
  cameraCardLarge: {
    height: 390,
    overflow: "hidden",
    borderRadius: 32,
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: COLORS.stroke,
    marginBottom: 18
  },
  camera: {
    flex: 1
  },
  cameraOff: {
    flex: 1,
    backgroundColor: "#050816",
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  cameraOffTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
    marginBottom: 8
  },
  cameraOffText: {
    color: COLORS.textSoft,
    fontSize: 14,
    textAlign: "center",
    writingDirection: "rtl",
    lineHeight: 22
  },
  cameraOverlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center"
  },
  scanFrame: {
    width: 230,
    height: 230,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "transparent"
  },
  scanFrameWide: {
    width: 285,
    height: 145,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "transparent"
  },
  cameraHint: {
    position: "absolute",
    bottom: 22,
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
    backgroundColor: "rgba(8,14,30,0.78)",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16
  },
  topBar: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18
  },
  ghostButton: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 11
  },
  ghostButtonText: {
    color: COLORS.text,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl"
  },
  connectionPill: {
    flexDirection: "row-reverse",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 11
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 99,
    marginLeft: 8
  },
  connectionText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl"
  },
  controlsRow: {
    flexDirection: "row-reverse",
    marginBottom: 18
  },
  cartCard: {
    backgroundColor: COLORS.card,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 18
  },
  cartHeader: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  clearText: {
    color: COLORS.blue,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl"
  },
  summaryRow: {
    flexDirection: "row-reverse",
    marginTop: 14,
    marginBottom: 16
  },
  summaryBox: {
    flex: 1,
    backgroundColor: COLORS.card2,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 16,
    marginHorizontal: 5,
    alignItems: "flex-end"
  },
  summaryLabel: {
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 8
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl"
  },
  itemsList: {
    marginTop: 2
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 20,
    padding: 13,
    marginBottom: 10
  },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: COLORS.bg2,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10
  },
  itemIconText: {
    color: COLORS.blue,
    fontSize: 16
  },
  itemInfo: {
    flex: 1,
    alignItems: "flex-end"
  },
  itemName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 4
  },
  itemMeta: {
    color: COLORS.textSoft,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl"
  },
  itemPriceBox: {
    minWidth: 74,
    alignItems: "flex-start"
  },
  itemPrice: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900"
  },
  emptyCard: {
    marginTop: 8,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 22,
    padding: 24,
    alignItems: "center"
  },
  emptyText: {
    color: COLORS.textSoft,
    textAlign: "center",
    writingDirection: "rtl"
  },
  toastWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 14
  },
  toast: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8
  },
  toastText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl"
  }
});