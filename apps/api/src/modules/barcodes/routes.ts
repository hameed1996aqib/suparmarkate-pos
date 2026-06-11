import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import {
  detectBarcodeType,
  generateProductBarcodeCandidate,
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
    pngUrl: `${origin}/api/barcodes/products/${productId}/png`,
    labelUrl: `${origin}/api/barcodes/products/${productId}/label`
  };
}

async function generateUniqueProductBarcode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const barcode = generateProductBarcodeCandidate();
    const existing = await prisma.product.findUnique({ where: { barcode } });

    if (!existing) return barcode;
  }

  throw new Error("Could not generate a unique product barcode");
}

async function ensureProductBarcode(id: string) {
  const product = await prisma.product.findUnique({
    where: { id }
  });

  if (!product || product.deletedAt) return null;
  if (product.barcode && !product.barcode.startsWith("PRD-")) return product;

  return prisma.product.update({
    where: { id },
    data: {
      barcode: await generateUniqueProductBarcode()
    }
  });
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

  const product = await ensureProductBarcode(id);

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  const barcode = product.barcode || "";

  return c.json({
    data: {
      productId: product.id,
      productName: product.name,
      barcode,
      detectedType: detectBarcodeType(barcode),
      ...getProductBarcodeUrls(c, product.id)
    }
  });
});

barcodesRoute.get("/products/:id/svg", async (c) => {
  const id = c.req.param("id");

  const product = await ensureProductBarcode(id);

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  const svg = renderBarcodeSvg({
    text: product.barcode || ""
  });

  c.header("Content-Type", "image/svg+xml");
  return c.body(svg);
});

barcodesRoute.get("/products/:id/png", async (c) => {
  const id = c.req.param("id");

  const product = await ensureProductBarcode(id);

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  const png = await renderBarcodePng({
    text: product.barcode || ""
  });

  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" }
  });
});

barcodesRoute.get("/products/:id/label", async (c) => {
  const id = c.req.param("id");
  const layout = c.req.query("layout") === "sheet" ? "sheet" : "roll";
  const copies = Math.min(
    Math.max(Number.parseInt(c.req.query("copies") || "1", 10) || 1, 1),
    120
  );
  const product = await ensureProductBarcode(id);

  if (!product) {
    return c.html("<h1>Product not found</h1>", 404);
  }

  const origin = getOrigin(c);
  const svgUrl = `${origin}/api/barcodes/products/${product.id}/svg`;
  const price = c.req.query("price") || "";
  const labels = Array.from({ length: copies })
    .map(
      () => `
        <section class="label">
          <div class="name">${escapeHtml(product.name)}</div>
          <img src="${svgUrl}" alt="${escapeHtml(product.barcode || "")}" />
          ${price ? `<div class="price">${escapeHtml(price)}</div>` : ""}
        </section>
      `
    )
    .join("");

  return c.html(`
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>چاپ بارکود - ${escapeHtml(product.name)}</title>
  <style>
    @page { size: ${layout === "sheet" ? "A4" : "58mm 38mm"}; margin: ${layout === "sheet" ? "8mm" : "2mm"}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Tahoma, Arial, sans-serif;
      background: #fff;
      color: #111827;
    }
    .toolbar {
      position: sticky;
      top: 0;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      background: white;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 10px;
    }
    button {
      border: 1px solid #111827;
      background: #111827;
      color: white;
      padding: 8px 14px;
      cursor: pointer;
      font: inherit;
    }
    .sheet {
      display: grid;
      grid-template-columns: ${layout === "sheet" ? "repeat(3, 1fr)" : "1fr"};
      gap: ${layout === "sheet" ? "8px" : "0"};
      direction: rtl;
      width: 100%;
    }
    .label {
      width: 100%;
      min-height: ${layout === "sheet" ? "35mm" : "34mm"};
      border: ${layout === "sheet" ? "1px dashed #9ca3af" : "0"};
      padding: ${layout === "sheet" ? "6px" : "2mm"};
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
      ${layout === "roll" ? "page-break-after: always;" : ""}
      display: grid;
      align-content: center;
      gap: 4px;
    }
    .name {
      font-size: ${layout === "sheet" ? "11px" : "10px"};
      font-weight: 700;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    img {
      width: 100%;
      max-height: ${layout === "sheet" ? "22mm" : "20mm"};
      object-fit: contain;
    }
    .price {
      font-size: ${layout === "sheet" ? "11px" : "10px"};
      font-weight: 700;
    }
    @media print {
      .toolbar { display: none; }
      .label { border-color: transparent; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <strong>${escapeHtml(product.name)} - ${escapeHtml(product.barcode || "")}</strong>
    <button onclick="window.print()">چاپ بارکود</button>
  </div>
  <main class="sheet">${labels}</main>
</body>
</html>
  `);
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
