import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "./prisma";

const MIN_CART_QUANTITY = 0.0001;

function normalizeCartQuantity(value: number, fallback: number) {
  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return Math.max(MIN_CART_QUANTITY, fallback);
  }

  return Math.max(MIN_CART_QUANTITY, Math.round(quantity * 10000) / 10000);
}

type PosClientType = "desktop" | "mobile" | "unknown";

type PosClient = {
  id: string;
  sessionId: string;
  clientType: PosClientType;
  socket: WebSocket;
  connectedAt: Date;
};

type PosSession = {
  id: string;
  name: string;
  createdAt: Date;
  lastActivityAt: Date;
};

type PosSessionSettings = {
  warehouseId?: string | null;
  currencyId?: string | null;
  exchangeRate?: number;
};

type PosCartItem = {
  key: string;
  productId: string;
  productName: string;
  barcode: string | null;
  warehouseId: string;
  warehouseName: string | null;
  unitId: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  totalStock: number;
  expiryDate: Date | null;
  lotId: string | null;
};

type PosCart = {
  sessionId: string;
  items: PosCartItem[];
  updatedAt: Date;
};

const sessions = new Map<string, PosSession>();
const clientsBySession = new Map<string, Map<string, PosClient>>();
const cartsBySession = new Map<string, PosCart>();
const settingsBySession = new Map<string, PosSessionSettings>();

type HeldPosCart = {
  id: string;
  sessionId: string;
  name: string;
  cart: PosCart;
  summary: {
    sessionId: string;
    itemsCount: number;
    total: number;
    updatedAt: Date;
  };
  createdAt: Date;
};

const heldCartsBySession = new Map<string, HeldPosCart[]>();

let wsServerStarted = false;

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, data) => {
    if (typeof data === "bigint") return data.toString();
    return data;
  });
}

function sendToClient(client: PosClient, type: string, payload: unknown) {
  if (client.socket.readyState !== WebSocket.OPEN) return;

  client.socket.send(
    safeJson({
      type,
      payload,
      time: new Date().toISOString()
    })
  );
}

function touchSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivityAt = new Date();
}

export function createPosSession(name?: string) {
  const id = randomUUID();

  const session: PosSession = {
    id,
    name: name || `POS Session ${new Date().toLocaleString()}`,
    createdAt: new Date(),
    lastActivityAt: new Date()
  };

  sessions.set(id, session);

  cartsBySession.set(id, {
    sessionId: id,
    items: [],
    updatedAt: new Date()
  });

  settingsBySession.set(id, {
    warehouseId: null,
    currencyId: null,
    exchangeRate: 1
  });

  return session;
}

export function getPosSessions() {
  return Array.from(sessions.values()).map((session) => {
    const clients = clientsBySession.get(session.id);
    const cart = getPosCart(session.id);

    return {
      ...session,
      settings: getPosSessionSettings(session.id),
      clientsCount: clients?.size || 0,
      cartItemsCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      cartTotal: cart.items.reduce((sum, item) => sum + item.lineTotal, 0),
      clients: clients
        ? Array.from(clients.values()).map((client) => ({
            id: client.id,
            clientType: client.clientType,
            connectedAt: client.connectedAt
          }))
        : []
    };
  });
}

export function getPosSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const clients = clientsBySession.get(sessionId);
  const cart = getPosCart(sessionId);

  return {
    ...session,
    settings: getPosSessionSettings(sessionId),
    clientsCount: clients?.size || 0,
    cartItemsCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    cartTotal: cart.items.reduce((sum, item) => sum + item.lineTotal, 0),
    clients: clients
      ? Array.from(clients.values()).map((client) => ({
          id: client.id,
          clientType: client.clientType,
          connectedAt: client.connectedAt
        }))
      : []
  };
}

export function getPosSessionSettings(sessionId: string) {
  const existing = settingsBySession.get(sessionId);
  if (existing) return existing;

  const settings = {
    warehouseId: null,
    currencyId: null,
    exchangeRate: 1
  };

  settingsBySession.set(sessionId, settings);
  return settings;
}

export function updatePosSessionSettings(input: {
  sessionId: string;
  warehouseId?: string | null;
  currencyId?: string | null;
  exchangeRate?: number;
}) {
  const current = getPosSessionSettings(input.sessionId);
  const currentRate = Number(current.exchangeRate || 1);
  const nextRate =
    input.exchangeRate === undefined
      ? currentRate
      : Math.max(Number(input.exchangeRate || 1), 0.00000001);

  const next = {
    ...current,
    warehouseId: input.warehouseId === undefined ? current.warehouseId : input.warehouseId,
    currencyId: input.currencyId === undefined ? current.currencyId : input.currencyId,
    exchangeRate: nextRate
  };

  settingsBySession.set(input.sessionId, next);
  touchSession(input.sessionId);

  if (nextRate !== currentRate) {
    const cart = getPosCart(input.sessionId);
    for (const item of cart.items) {
      item.unitPrice = (item.unitPrice * currentRate) / nextRate;
      item.discount = (item.discount * currentRate) / nextRate;
      item.lineTotal = Math.max(0, item.quantity * item.unitPrice - item.discount);
    }
    cart.updatedAt = new Date();
    for (const heldCart of heldCartsBySession.get(input.sessionId) || []) {
      for (const item of heldCart.cart.items) {
        item.unitPrice = (item.unitPrice * currentRate) / nextRate;
        item.discount = (item.discount * currentRate) / nextRate;
        item.lineTotal = Math.max(0, item.quantity * item.unitPrice - item.discount);
      }
      heldCart.cart.updatedAt = new Date();
      heldCart.summary.total = heldCart.cart.items.reduce(
        (sum, item) => sum + item.lineTotal,
        0
      );
      heldCart.summary.updatedAt = heldCart.cart.updatedAt;
    }
    broadcastCartUpdated(input.sessionId);
  }

  broadcastToPosSession(input.sessionId, "SESSION_SETTINGS_UPDATED", {
    settings: next
  });

  return next;
}

export function getPosCart(sessionId: string): PosCart {
  const existing = cartsBySession.get(sessionId);
  if (existing) return existing;

  const cart = {
    sessionId,
    items: [],
    updatedAt: new Date()
  };

  cartsBySession.set(sessionId, cart);
  return cart;
}

export function getPosCartSummary(sessionId: string) {
  const cart = getPosCart(sessionId);

  return {
    sessionId,
    itemsCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    total: cart.items.reduce((sum, item) => sum + item.lineTotal, 0),
    updatedAt: cart.updatedAt
  };
}

export function clearPosCart(sessionId: string) {
  const cart = {
    sessionId,
    items: [],
    updatedAt: new Date()
  };

  cartsBySession.set(sessionId, cart);
  touchSession(sessionId);
  broadcastCartUpdated(sessionId);

  return cart;
}

export function updatePosCartItem(input: {
  sessionId: string;
  key: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
}) {
  const cart = getPosCart(input.sessionId);

  cart.items = cart.items.map((item) => {
    if (item.key !== input.key) return item;

    const quantity =
      input.quantity === undefined
        ? item.quantity
        : normalizeCartQuantity(input.quantity, item.quantity);

    const unitPrice =
      input.unitPrice === undefined
        ? item.unitPrice
        : Math.max(0, Number(input.unitPrice || 0));

    const discount =
      input.discount === undefined
        ? item.discount
        : Math.max(0, Number(input.discount || 0));

    return {
      ...item,
      quantity,
      unitPrice,
      discount,
      lineTotal: Math.max(0, quantity * unitPrice - discount)
    };
  });

  cart.updatedAt = new Date();

  cartsBySession.set(input.sessionId, cart);
  touchSession(input.sessionId);
  broadcastCartUpdated(input.sessionId);

  return cart;
}

export function updatePosCartItemQuantity(input: {
  sessionId: string;
  key: string;
  quantity: number;
}) {
  return updatePosCartItem({
    sessionId: input.sessionId,
    key: input.key,
    quantity: input.quantity
  });
}

export function removePosCartItem(input: {
  sessionId: string;
  key: string;
}) {
  const cart = getPosCart(input.sessionId);

  cart.items = cart.items.filter((item) => item.key !== input.key);
  cart.updatedAt = new Date();

  cartsBySession.set(input.sessionId, cart);
  touchSession(input.sessionId);
  broadcastCartUpdated(input.sessionId);

  return cart;
}

export function broadcastToPosSession(sessionId: string, type: string, payload: unknown) {
  const clients = clientsBySession.get(sessionId);
  if (!clients) return 0;

  let sent = 0;

  for (const client of clients.values()) {
    sendToClient(client, type, payload);
    sent += 1;
  }

  touchSession(sessionId);
  return sent;
}

export function broadcastCartUpdated(sessionId: string) {
  const cart = getPosCart(sessionId);

  return broadcastToPosSession(sessionId, "CART_UPDATED", {
    cart,
    summary: getPosCartSummary(sessionId)
  });
}

function addPayloadToCart(input: {
  sessionId: string;
  payload: {
    product: any;
    defaultSaleUnit: any;
    totalStock: number;
    recommendedLot: any;
    lots: any[];
  };
}) {
  const cart = getPosCart(input.sessionId);
  const product = input.payload.product;

  const defaultSaleUnit =
    input.payload.defaultSaleUnit ||
    (product.units || []).find((item: any) => item.isDefaultSale) ||
    (product.units || [])[0] ||
    null;

  const unitId = defaultSaleUnit?.unitId || product.baseUnitId;
  const unitName =
    defaultSaleUnit?.unit?.shortName ||
    defaultSaleUnit?.unit?.name ||
    product.baseUnit?.shortName ||
    product.baseUnit?.name ||
    "Unit";

  const exchangeRate = Number(getPosSessionSettings(input.sessionId).exchangeRate || 1);
  const unitPrice = Number(defaultSaleUnit?.salePrice || 0) / exchangeRate;
  const recommendedLot = input.payload.recommendedLot;
  const warehouseId = recommendedLot?.warehouseId || "";
  const warehouseName = recommendedLot?.warehouse?.name || null;
  const lotId = recommendedLot?.id || null;

  const key = `${product.id}:${unitId}:${warehouseId}`;

  const existing = cart.items.find((item) => item.key === key);

  if (existing) {
    existing.quantity += 1;
    existing.totalStock = Number(input.payload.totalStock || 0);
    existing.lineTotal = Math.max(0, existing.quantity * existing.unitPrice - existing.discount);
  } else {
    cart.items.unshift({
      key,
      productId: product.id,
      productName: product.name,
      barcode: product.barcode || null,
      warehouseId,
      warehouseName,
      unitId,
      unitName,
      quantity: 1,
      unitPrice,
      discount: 0,
      lineTotal: unitPrice,
      totalStock: Number(input.payload.totalStock || 0),
      expiryDate: recommendedLot?.expiryDate || null,
      lotId
    });
  }

  cart.updatedAt = new Date();

  cartsBySession.set(input.sessionId, cart);
  touchSession(input.sessionId);

  return cart;
}

export async function handlePosBarcodeScan(input: {
  sessionId: string;
  barcode: string;
  warehouseId?: string | null;
  source?: "http" | "websocket";
}) {
  const barcode = input.barcode.trim();

  if (!barcode) {
    const payload = {
      barcode,
      message: "Barcode is required"
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, error: payload };
  }

  const sessionSettings = getPosSessionSettings(input.sessionId);
  const warehouseIdForScan = input.warehouseId || sessionSettings.warehouseId || null;

  const product = await prisma.product.findUnique({
    where: { barcode },
    include: {
      baseUnit: true,
      units: {
        include: {
          unit: true
        }
      }
    }
  });

  if (!product) {
    const payload = {
      barcode,
      message: "Product not found"
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", payload);
    return { ok: false, error: payload };
  }

  const lots = await prisma.stockLot.findMany({
    where: {
      productId: product.id,
      remainingQuantity: {
        gt: 0
      },
      ...(warehouseIdForScan ? { warehouseId: warehouseIdForScan } : {})
    },
    include: {
      warehouse: true
    },
    orderBy: [
      {
        expiryDate: "asc"
      },
      {
        createdAt: "asc"
      }
    ]
  });

  const totalStock = lots.reduce((sum, lot) => {
    return sum + Number(lot.remainingQuantity);
  }, 0);

  const defaultSaleUnit =
    product.units.find((item) => item.isDefaultSale) || product.units[0] || null;

  const payload = {
    sessionId: input.sessionId,
    source: input.source || "http",
    barcode,
    product,
    defaultSaleUnit,
    totalStock,
    lots,
    recommendedLot: lots[0] || null,
    activeWarehouseId: warehouseIdForScan
  };

  if (!payload.recommendedLot || totalStock <= 0) {
    const errorPayload = {
      barcode,
      product,
      totalStock,
      activeWarehouseId: warehouseIdForScan,
      message: "Product is out of stock"
    };

    broadcastToPosSession(input.sessionId, "SCAN_ERROR", errorPayload);
    return { ok: false, error: errorPayload };
  }

  const cart = addPayloadToCart({
    sessionId: input.sessionId,
    payload
  });

  broadcastToPosSession(input.sessionId, "BARCODE_SCANNED", payload);
  broadcastCartUpdated(input.sessionId);

  return {
    ok: true,
    data: {
      ...payload,
      cart,
      cartSummary: getPosCartSummary(input.sessionId)
    }
  };
}


export function getHeldPosCarts(sessionId: string) {
  return heldCartsBySession.get(sessionId) || [];
}

export function holdPosCart(input: {
  sessionId: string;
  name?: string | null;
}) {
  const currentCart = getPosCart(input.sessionId);

  if (!currentCart.items.length) {
    return {
      held: null,
      cart: currentCart,
      summary: getPosCartSummary(input.sessionId)
    };
  }

  const held: HeldPosCart = {
    id: randomUUID(),
    sessionId: input.sessionId,
    name: input.name?.trim() || `Held sale ${new Date().toLocaleTimeString()}`,
    cart: {
      sessionId: currentCart.sessionId,
      items: currentCart.items.map((item) => ({ ...item })),
      updatedAt: new Date(currentCart.updatedAt)
    },
    summary: {
      ...getPosCartSummary(input.sessionId)
    },
    createdAt: new Date()
  };

  const list = heldCartsBySession.get(input.sessionId) || [];
  heldCartsBySession.set(input.sessionId, [held, ...list]);

  clearPosCart(input.sessionId);

  broadcastToPosSession(input.sessionId, "HELD_CARTS_UPDATED", {
    heldCarts: getHeldPosCarts(input.sessionId)
  });

  return {
    held,
    cart: getPosCart(input.sessionId),
    summary: getPosCartSummary(input.sessionId)
  };
}

export function restoreHeldPosCart(input: {
  sessionId: string;
  heldCartId: string;
}) {
  const list = heldCartsBySession.get(input.sessionId) || [];
  const held = list.find((item) => item.id === input.heldCartId);

  if (!held) {
    return null;
  }

  const restoredCart: PosCart = {
    sessionId: input.sessionId,
    items: held.cart.items.map((item) => ({ ...item })),
    updatedAt: new Date()
  };

  cartsBySession.set(input.sessionId, restoredCart);

  heldCartsBySession.set(
    input.sessionId,
    list.filter((item) => item.id !== input.heldCartId)
  );

  touchSession(input.sessionId);
  broadcastCartUpdated(input.sessionId);

  broadcastToPosSession(input.sessionId, "HELD_CARTS_UPDATED", {
    heldCarts: getHeldPosCarts(input.sessionId)
  });

  return {
    held,
    cart: restoredCart,
    summary: getPosCartSummary(input.sessionId)
  };
}

export function deleteHeldPosCart(input: {
  sessionId: string;
  heldCartId: string;
}) {
  const list = heldCartsBySession.get(input.sessionId) || [];

  heldCartsBySession.set(
    input.sessionId,
    list.filter((item) => item.id !== input.heldCartId)
  );

  touchSession(input.sessionId);

  broadcastToPosSession(input.sessionId, "HELD_CARTS_UPDATED", {
    heldCarts: getHeldPosCarts(input.sessionId)
  });

  return getHeldPosCarts(input.sessionId);
}

export function startPosWebSocketServer(port = 4001) {
  if (wsServerStarted) return;

  wsServerStarted = true;

  const wss = new WebSocketServer({ port });

  wss.on("connection", (socket, request) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const sessionId = requestUrl.searchParams.get("sessionId") || "";
    const clientTypeRaw = requestUrl.searchParams.get("clientType") || "unknown";

    const clientType: PosClientType =
      clientTypeRaw === "desktop" || clientTypeRaw === "mobile"
        ? clientTypeRaw
        : "unknown";

    if (!sessionId) {
      socket.send(
        safeJson({
          type: "CONNECTION_ERROR",
          payload: { message: "sessionId is required" }
        })
      );
      socket.close();
      return;
    }

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        id: sessionId,
        name: "External POS Session",
        createdAt: new Date(),
        lastActivityAt: new Date()
      });
    }

    getPosCart(sessionId);
    getPosSessionSettings(sessionId);

    const client: PosClient = {
      id: randomUUID(),
      sessionId,
      clientType,
      socket,
      connectedAt: new Date()
    };

    if (!clientsBySession.has(sessionId)) {
      clientsBySession.set(sessionId, new Map());
    }

    clientsBySession.get(sessionId)?.set(client.id, client);

    sendToClient(client, "CONNECTED", {
      clientId: client.id,
      sessionId,
      clientType,
      websocketPort: port
    });

    sendToClient(client, "CART_UPDATED", {
      cart: getPosCart(sessionId),
      summary: getPosCartSummary(sessionId)
    });

    sendToClient(client, "SESSION_SETTINGS_UPDATED", {
      settings: getPosSessionSettings(sessionId)
    });

    sendToClient(client, "HELD_CARTS_UPDATED", {
      heldCarts: getHeldPosCarts(sessionId)
    });

    broadcastToPosSession(sessionId, "CLIENT_CONNECTED", {
      clientId: client.id,
      clientType
    });

    socket.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(String(rawMessage));

        if (message.type === "PING") {
          sendToClient(client, "PONG", { clientId: client.id });
          return;
        }

        if (message.type === "SET_SESSION_SETTINGS" || message.type === "SET_ACTIVE_WAREHOUSE") {
          updatePosSessionSettings({
            sessionId,
            warehouseId:
              message.warehouseId === undefined
                ? undefined
                : message.warehouseId
                  ? String(message.warehouseId)
                  : null,
            currencyId:
              message.currencyId === undefined
                ? undefined
                : message.currencyId
                  ? String(message.currencyId)
                  : null,
            exchangeRate:
              message.exchangeRate === undefined ? undefined : Number(message.exchangeRate || 1)
          });
          return;
        }

        if (message.type === "SCAN_BARCODE") {
          await handlePosBarcodeScan({
            sessionId,
            barcode: String(message.barcode || ""),
            warehouseId: message.warehouseId ? String(message.warehouseId) : null,
            source: "websocket"
          });
          return;
        }

        if (message.type === "CLEAR_CART") {
          clearPosCart(sessionId);
          return;
        }

        if (message.type === "HOLD_CART") {
          holdPosCart({
            sessionId,
            name: message.name ? String(message.name) : null
          });
          return;
        }

        if (message.type === "RESTORE_HELD_CART") {
          restoreHeldPosCart({
            sessionId,
            heldCartId: String(message.heldCartId || "")
          });
          return;
        }

        if (message.type === "DELETE_HELD_CART") {
          deleteHeldPosCart({
            sessionId,
            heldCartId: String(message.heldCartId || "")
          });
          return;
        }

        if (message.type === "UPDATE_CART_ITEM_QTY") {
          updatePosCartItemQuantity({
            sessionId,
            key: String(message.key || ""),
            quantity: Number(message.quantity ?? 1)
          });
          return;
        }

        if (message.type === "UPDATE_CART_ITEM") {
          updatePosCartItem({
            sessionId,
            key: String(message.key || ""),
            quantity: message.quantity === undefined ? undefined : Number(message.quantity),
            unitPrice: message.unitPrice === undefined ? undefined : Number(message.unitPrice),
            discount: message.discount === undefined ? undefined : Number(message.discount)
          });
          return;
        }

        if (message.type === "REMOVE_CART_ITEM") {
          removePosCartItem({
            sessionId,
            key: String(message.key || "")
          });
          return;
        }

        sendToClient(client, "UNKNOWN_MESSAGE", { message });
      } catch (error) {
        sendToClient(client, "MESSAGE_ERROR", {
          message: "Invalid websocket message",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on("close", () => {
      clientsBySession.get(sessionId)?.delete(client.id);

      broadcastToPosSession(sessionId, "CLIENT_DISCONNECTED", {
        clientId: client.id,
        clientType
      });
    });
  });

  console.log(`POS WebSocket running on ws://localhost:${port}`);
}
