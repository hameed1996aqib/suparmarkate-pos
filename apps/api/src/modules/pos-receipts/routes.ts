import { Hono } from "hono";
import { prisma } from "../../lib/prisma";

export const posReceiptsRoute = new Hono();

function money(value: unknown) {
  return new Intl.NumberFormat("fa-AF", {
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function safeText(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getReceiptWidth(raw: string | null) {
  const width = Number(raw || 80);
  return width === 58 ? 58 : 80;
}

function getCustomerLabel(sale: any) {
  if (sale.customer?.name) {
    return sale.customer.name;
  }

  const note = String(sale.note || "");
  const marker = "Customer:";

  if (note.includes(marker)) {
    return note.split(marker)[1]?.trim() || "مشتری نقدی";
  }

  return "مشتری نقدی";
}

posReceiptsRoute.get("/sales/:id/html", async (c) => {
  const id = c.req.param("id");
  const widthMm = getReceiptWidth(c.req.query("width") || null);

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      currency: true,
      customer: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true
        }
      }
    }
  });

  if (!sale) {
    return c.html("<h1>Sale not found</h1>", 404);
  }

  const setting = await prisma.companySetting.findFirst().catch(() => null);

  const companyName = setting?.companyName || "Muhaseb POS";
  const phone = setting?.phone || "";
  const address = setting?.address || "";
  const logoImage = setting?.logoImage || "";

  const subtotal = sale.items.reduce((sum, item) => {
    return sum + Number(item.quantity || 0) * Number(item.unitPrice || 0);
  }, 0);

  const discount = Number((sale as any).discount || 0);
  const total = Number((sale as any).total || subtotal - discount);
  const paidAmount = Number((sale as any).paidAmount || total);
  const changeAmount = Math.max(0, paidAmount - total);

  const currencyLabel = sale.currency?.symbol || sale.currency?.code || "";
  const customerLabel = getCustomerLabel(sale);

  const html = `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>رسید فروش ${safeText((sale as any).invoiceNo || sale.id)}</title>
  <style>
    @page {
      size: ${widthMm}mm auto;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: white;
      color: #000;
      font-family: Tahoma, Arial, sans-serif;
    }

    body {
      width: ${widthMm}mm;
      max-width: ${widthMm}mm;
      padding: ${widthMm === 58 ? "5px" : "8px"};
      font-size: ${widthMm === 58 ? "10px" : "12px"};
      line-height: 1.6;
    }

    .center {
      text-align: center;
    }

    .company {
      font-size: ${widthMm === 58 ? "14px" : "17px"};
      font-weight: 900;
      margin-bottom: 2px;
    }

    .company-logo {
      width: ${widthMm === 58 ? "44px" : "56px"};
      height: ${widthMm === 58 ? "44px" : "56px"};
      object-fit: contain;
      display: block;
      margin: 0 auto 5px;
    }

    .muted {
      color: #333;
      font-size: ${widthMm === 58 ? "9px" : "10px"};
    }

    .line {
      border-top: 1px dashed #000;
      margin: 7px 0;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 2px 0;
    }

    .row strong {
      font-weight: 900;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    th,
    td {
      padding: 3px 1px;
      border-bottom: 1px dashed #bbb;
      vertical-align: top;
      text-align: right;
    }

    th {
      font-weight: 900;
      border-bottom: 1px solid #000;
    }

    .product-name {
      font-weight: 800;
    }

    .ltr {
      direction: ltr;
      text-align: left;
    }

    .total-box {
      margin-top: 6px;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 5px 0;
    }

    .total-row {
      font-size: ${widthMm === 58 ? "12px" : "15px"};
      font-weight: 900;
    }

    .footer {
      margin-top: 8px;
      text-align: center;
      font-size: ${widthMm === 58 ? "9px" : "10px"};
    }
  </style>
</head>
<body>
  <div class="center">
    ${logoImage ? `<img class="company-logo" src="${safeText(logoImage)}" />` : ""}
    <div class="company">${safeText(companyName)}</div>
    ${phone ? `<div class="muted">شماره تماس: ${safeText(phone)}</div>` : ""}
    ${address ? `<div class="muted">${safeText(address)}</div>` : ""}
  </div>

  <div class="line"></div>

  <div class="row">
    <span>شماره فاکتور:</span>
    <strong>${safeText((sale as any).invoiceNo || sale.id)}</strong>
  </div>

  <div class="row">
    <span>تاریخ:</span>
    <strong>${new Date((sale as any).createdAt).toLocaleString("fa-AF")}</strong>
  </div>

  <div class="row">
    <span>مشتری:</span>
    <strong>${safeText(customerLabel)}</strong>
  </div>

  <div class="line"></div>

  <table>
    <thead>
      <tr>
        <th>محصول</th>
        <th>تعداد</th>
        <th>قیمت</th>
        <th>جمع</th>
      </tr>
    </thead>
    <tbody>
      ${sale.items
        .map((item) => {
          const qty = Number(item.quantity || 0);
          const price = Number(item.unitPrice || 0);
          const itemDiscount = Number((item as any).discount || 0);
          const lineTotal = Math.max(0, qty * price - itemDiscount);

          return `
            <tr>
              <td>
                <div class="product-name">${safeText(item.product?.name || "-")}</div>
                <div class="muted">گدام: ${safeText(item.warehouse?.name || "-")}</div>
                <div class="muted">واحد: ${safeText(item.unit?.shortName || item.unit?.name || "-")}</div>
              </td>
              <td>${money(qty)}</td>
              <td>${money(price)}</td>
              <td>${money(lineTotal)}</td>
            </tr>
          `;
        })
        .join("")}
    </tbody>
  </table>

  <div class="total-box">
    <div class="row">
      <span>جمع اجناس:</span>
      <strong>${money(subtotal)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>تخفیف:</span>
      <strong>${money(discount)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row total-row">
      <span>قابل پرداخت:</span>
      <strong>${money(total)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>دریافت‌شده:</span>
      <strong>${money(paidAmount)} ${safeText(currencyLabel)}</strong>
    </div>

    <div class="row">
      <span>برگشت پول:</span>
      <strong>${money(changeAmount)} ${safeText(currencyLabel)}</strong>
    </div>
  </div>

  <div class="footer">
    <div>تشکر از خرید شما</div>
    <div class="muted">Powered by Muhaseb POS</div>
  </div>

  <script>
    window.addEventListener("load", () => {
      setTimeout(() => window.focus(), 100);
    });
  </script>
</body>
</html>
`;

  return c.html(html);
});
