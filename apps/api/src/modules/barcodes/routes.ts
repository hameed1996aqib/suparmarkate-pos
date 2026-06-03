import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import {
  detectBarcodeType,
  normalizeBarcodeText,
  renderBarcodePng,
  renderBarcodeSvg
} from "../../lib/barcode";

export const barcodesRoute = new Hono();

function getOrigin(c: any) {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function getProductBarcodeUrls(c: any, productId: string) {
  const origin = getOrigin(c);

  return {
    svgUrl: `${origin}/api/barcodes/products/${productId}/svg`,
    pngUrl: `${origin}/api/barcodes/products/${productId}/png`
  };
}

barcodesRoute.get("/preview/meta", (c) => {
  const text = normalizeBarcodeText(c.req.query("text") || "");

  if (!text) {
    return c.json({ message: "text is required" }, 400);
  }

  const format = c.req.query("format") || null;
  const origin = getOrigin(c);

  return c.json({
    data: {
      text,
      detectedType: format || detectBarcodeType(text),
      svgUrl: `${origin}/api/barcodes/preview/svg?text=${encodeURIComponent(text)}${format ? `&format=${encodeURIComponent(format)}` : ""}`,
      pngUrl: `${origin}/api/barcodes/preview/png?text=${encodeURIComponent(text)}${format ? `&format=${encodeURIComponent(format)}` : ""}`
    }
  });
});

barcodesRoute.get("/preview/svg", (c) => {
  const text = normalizeBarcodeText(c.req.query("text") || "");

  if (!text) {
    return c.json({ message: "text is required" }, 400);
  }

  const format = c.req.query("format") || null;
  const svg = renderBarcodeSvg({ text, format });

  c.header("Content-Type", "image/svg+xml");
  return c.body(svg);
});

barcodesRoute.get("/preview/png", async (c) => {
  const text = normalizeBarcodeText(c.req.query("text") || "");

  if (!text) {
    return c.json({ message: "text is required" }, 400);
  }

  const format = c.req.query("format") || null;
  const png = await renderBarcodePng({ text, format });

  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" }
  });
});

barcodesRoute.get("/products/:id/meta", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.product.findUnique({
    where: { id }
  });

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!product.barcode) {
    return c.json({ message: "This product does not have a barcode" }, 400);
  }

  return c.json({
    data: {
      productId: product.id,
      productName: product.name,
      barcode: product.barcode,
      detectedType: detectBarcodeType(product.barcode),
      ...getProductBarcodeUrls(c, product.id)
    }
  });
});

barcodesRoute.get("/products/:id/svg", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.product.findUnique({
    where: { id }
  });

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!product.barcode) {
    return c.json({ message: "This product does not have a barcode" }, 400);
  }

  const svg = renderBarcodeSvg({
    text: product.barcode
  });

  c.header("Content-Type", "image/svg+xml");
  return c.body(svg);
});

barcodesRoute.get("/products/:id/png", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.product.findUnique({
    where: { id }
  });

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!product.barcode) {
    return c.json({ message: "This product does not have a barcode" }, 400);
  }

  const png = await renderBarcodePng({
    text: product.barcode
  });

  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" }
  });
});
