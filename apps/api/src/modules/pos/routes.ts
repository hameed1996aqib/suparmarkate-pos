import { Hono } from "hono";
import { z } from "zod";
import QRCode from "qrcode";
import { zodError } from "../../lib/api";
import {
  clearPosCart,
  createPosSession,
  getPosCart,
  getPosCartSummary,
  getHeldPosCarts,
  holdPosCart,
  restoreHeldPosCart,
  deleteHeldPosCart,
  getPosSession,
  getPosSessionSettings,
  getPosSessions,
  handlePosBarcodeScan,
  removePosCartItem,
  updatePosCartItem,
  updatePosSessionSettings
} from "../../lib/pos-realtime";

export const posRoute = new Hono();

const createSessionSchema = z.object({
  name: z.string().trim().max(120).optional().nullable()
});

const scanSchema = z.object({
  sessionId: z.string().min(1),
  barcode: z.string().trim().min(1),
  warehouseId: z.string().trim().optional().nullable()
});

function getBaseUrls(c: any, sessionId: string) {
  const url = new URL(c.req.url);
  const apiBaseUrl = `${url.protocol}//${url.host}`;
  const hostname = url.hostname;

  const mobileWebSocketUrl = `ws://${hostname}:4001?sessionId=${sessionId}&clientType=mobile`;
  const desktopWebSocketUrl = `ws://${hostname}:4001?sessionId=${sessionId}&clientType=desktop`;
  const scanHttpUrl = `${apiBaseUrl}/api/pos/scan`;

  const qrPayload = JSON.stringify({
    sessionId,
    apiBaseUrl,
    webSocketUrl: mobileWebSocketUrl,
    scanHttpUrl
  });

  return {
    apiBaseUrl,
    mobileWebSocketUrl,
    desktopWebSocketUrl,
    scanHttpUrl,
    qrPayload
  };
}

posRoute.get("/sessions", (c) => {
  return c.json({
    data: getPosSessions()
  });
});

posRoute.post("/sessions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSessionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const session = createPosSession(parsed.data.name || undefined);
  const urls = getBaseUrls(c, session.id);

  return c.json(
    {
      data: {
        session,
        settings: getPosSessionSettings(session.id),
        connection: {
          sessionId: session.id,
          apiBaseUrl: urls.apiBaseUrl,
          mobileWebSocketUrl: urls.mobileWebSocketUrl,
          desktopWebSocketUrl: urls.desktopWebSocketUrl,
          mobileScanHttpUrl: urls.scanHttpUrl,
          qrPayload: urls.qrPayload,
          qrImageUrl: `${urls.apiBaseUrl}/api/pos/sessions/${session.id}/qr.svg`,
          qrPageUrl: `${urls.apiBaseUrl}/api/pos/sessions/${session.id}/connect`,
          testPageUrl: `${urls.apiBaseUrl}/api/pos/sessions/${session.id}/test`
        }
      }
    },
    201
  );
});

posRoute.get("/sessions/:id/settings", (c) => {
  const id = c.req.param("id");

  return c.json({
    data: {
      settings: getPosSessionSettings(id)
    }
  });
});

posRoute.patch("/sessions/:id/settings", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  return c.json({
    data: {
      settings: updatePosSessionSettings({
        sessionId: id,
        warehouseId: body.warehouseId === undefined ? undefined : body.warehouseId || null,
        currencyId: body.currencyId === undefined ? undefined : body.currencyId || null,
        exchangeRate: body.exchangeRate === undefined ? undefined : Number(body.exchangeRate || 1)
      })
    }
  });
});


posRoute.get("/sessions/:id/held-carts", (c) => {
  const id = c.req.param("id");

  return c.json({
    data: {
      heldCarts: getHeldPosCarts(id)
    }
  });
});

posRoute.post("/sessions/:id/held-carts", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  return c.json({
    data: holdPosCart({
      sessionId: id,
      name: body.name || null
    })
  });
});

posRoute.post("/sessions/:id/held-carts/:heldCartId/restore", (c) => {
  const id = c.req.param("id");
  const heldCartId = c.req.param("heldCartId");

  const result = restoreHeldPosCart({
    sessionId: id,
    heldCartId
  });

  if (!result) {
    return c.json({ message: "Held cart not found" }, 404);
  }

  return c.json({
    data: result
  });
});

posRoute.delete("/sessions/:id/held-carts/:heldCartId", (c) => {
  const id = c.req.param("id");
  const heldCartId = c.req.param("heldCartId");

  return c.json({
    data: {
      heldCarts: deleteHeldPosCart({
        sessionId: id,
        heldCartId
      })
    }
  });
});

posRoute.get("/sessions/:id/cart", (c) => {
  const id = c.req.param("id");

  return c.json({
    data: {
      cart: getPosCart(id),
      summary: getPosCartSummary(id)
    }
  });
});

posRoute.delete("/sessions/:id/cart", (c) => {
  const id = c.req.param("id");

  return c.json({
    data: {
      cart: clearPosCart(id),
      summary: getPosCartSummary(id)
    }
  });
});

posRoute.patch("/sessions/:id/cart/items/:key", async (c) => {
  const id = c.req.param("id");
  const key = c.req.param("key");
  const body = await c.req.json().catch(() => ({}));

  return c.json({
    data: {
      cart: updatePosCartItem({
        sessionId: id,
        key,
        quantity: body.quantity === undefined ? undefined : Number(body.quantity),
        unitPrice: body.unitPrice === undefined ? undefined : Number(body.unitPrice),
        discount: body.discount === undefined ? undefined : Number(body.discount)
      }),
      summary: getPosCartSummary(id)
    }
  });
});

posRoute.delete("/sessions/:id/cart/items/:key", (c) => {
  const id = c.req.param("id");
  const key = c.req.param("key");

  return c.json({
    data: {
      cart: removePosCartItem({
        sessionId: id,
        key
      }),
      summary: getPosCartSummary(id)
    }
  });
});

posRoute.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = getPosSession(id);

  if (!session) {
    return c.json({ message: "POS session not found" }, 404);
  }

  const urls = getBaseUrls(c, id);

  return c.json({
    data: {
      session,
      settings: getPosSessionSettings(id),
      connection: {
        sessionId: id,
        apiBaseUrl: urls.apiBaseUrl,
        mobileWebSocketUrl: urls.mobileWebSocketUrl,
        desktopWebSocketUrl: urls.desktopWebSocketUrl,
        mobileScanHttpUrl: urls.scanHttpUrl,
        qrPayload: urls.qrPayload,
        qrImageUrl: `${urls.apiBaseUrl}/api/pos/sessions/${id}/qr.svg`,
        qrPageUrl: `${urls.apiBaseUrl}/api/pos/sessions/${id}/connect`,
        testPageUrl: `${urls.apiBaseUrl}/api/pos/sessions/${id}/test`
      }
    }
  });
});

posRoute.get("/sessions/:id/qr.svg", async (c) => {
  const id = c.req.param("id");
  const session = getPosSession(id);

  if (!session) {
    return c.text("POS session not found", 404);
  }

  const urls = getBaseUrls(c, id);

  const svg = await QRCode.toString(urls.qrPayload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320
  });

  c.header("Content-Type", "image/svg+xml");
  return c.body(svg);
});

posRoute.get("/sessions/:id/connect", async (c) => {
  const id = c.req.param("id");
  const session = getPosSession(id);

  if (!session) {
    return c.html("<h1>POS session not found</h1>", 404);
  }

  const urls = getBaseUrls(c, id);

  return c.html(`
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>اتصال موبایل به POS</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Tahoma, Arial, sans-serif;
      background: #020617;
      color: #f8fafc;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(520px, 100%);
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 24px;
      padding: 24px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0,0,0,.35);
    }
    img {
      width: 320px;
      max-width: 100%;
      background: white;
      padding: 14px;
      border-radius: 18px;
      margin: 16px auto;
      display: block;
    }
    code {
      direction: ltr;
      text-align: left;
      display: block;
      background: #020617;
      border: 1px solid #334155;
      color: #5eead4;
      padding: 10px;
      border-radius: 12px;
      word-break: break-all;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>اتصال موبایل به صندوق فروش</h1>
    <p>اپ موبایل را باز کن و این QR را اسکن کن.</p>
    <img src="/api/pos/sessions/${id}/qr.svg" alt="POS QR Code" />
    <p>Session ID:</p>
    <code>${id}</code>
    <p>API:</p>
    <code>${urls.apiBaseUrl}</code>
  </div>
</body>
</html>
  `);
});

posRoute.post("/scan", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = scanSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const result = await handlePosBarcodeScan({
    sessionId: parsed.data.sessionId,
    barcode: parsed.data.barcode,
    warehouseId: parsed.data.warehouseId ?? null,
    source: "http"
  });

  if (!result.ok) {
    return c.json(result, 404);
  }

  return c.json({
    data: result.data
  });
});
