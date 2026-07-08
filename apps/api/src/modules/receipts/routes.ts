import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { PartyTransactionType } from "../../generated/prisma/enums";

export const receiptsRoute = new Hono();

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value: unknown) {
  const number = Number(value ?? 0);

  return new Intl.NumberFormat("fa-AF", {
    maximumFractionDigits: 2,
  }).format(number);
}

function formatDate(value: Date | string) {
  const date = new Date(value);

  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function getSetting() {
  return prisma.companySetting.findFirst({
    orderBy: {
      createdAt: "asc",
    },
  });
}

function receiptHeader(setting: Awaited<ReturnType<typeof getSetting>>) {
  return `
    ${
      setting?.logoImage
        ? `<img class="company-logo" src="${escapeHtml(setting.logoImage)}" />`
        : ""
    }
    ${
      setting?.receiptHeaderImage
        ? `<img class="header-image" src="${escapeHtml(setting.receiptHeaderImage)}" />`
        : ""
    }

    <div class="center">
      <div class="company-name">${escapeHtml(setting?.companyName || "Supermarket")}</div>
      ${setting?.phone ? `<div class="muted">شماره تماس: ${escapeHtml(setting.phone)}</div>` : ""}
      ${setting?.address ? `<div class="muted">آدرس: ${escapeHtml(setting.address)}</div>` : ""}
    </div>
  `;
}

function receiptFooter(setting: Awaited<ReturnType<typeof getSetting>>) {
  return `
    <div class="line"></div>
    <div class="thanks">تشکر از همکاری شما</div>
    ${
      setting?.receiptFooterImage
        ? `<img class="footer-image" src="${escapeHtml(setting.receiptFooterImage)}" />`
        : ""
    }
  `;
}

function receiptCss() {
  return `
    @font-face {
      font-family: "Zain";
      src: url("/font/zain/Zain-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }

    @font-face {
      font-family: "Zain";
      src: url("/font/zain/Zain-Bold.ttf") format("truetype");
      font-weight: 700;
      font-style: normal;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: "Zain", Tahoma, Arial, sans-serif;
      font-size: 12px;
      direction: rtl;
    }

    .receipt {
      width: 80mm;
      margin: 0 auto;
      padding: 8px;
    }

    .center { text-align: center; }

    .header-image,
    .footer-image {
      width: 100%;
      max-height: 80px;
      object-fit: contain;
      display: block;
      margin: 0 auto 6px;
    }

    .company-logo {
      width: 58px;
      height: 58px;
      object-fit: contain;
      display: block;
      margin: 0 auto 6px;
    }

    .company-name {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .muted {
      color: #333;
      font-size: 11px;
    }

    .line {
      border-top: 1px dashed #000;
      margin: 8px 0;
    }

    .meta {
      display: grid;
      gap: 4px;
      margin-bottom: 8px;
    }

    .title {
      text-align: center;
      font-size: 15px;
      font-weight: 700;
      margin: 8px 0;
    }

    .total-box {
      border: 1px dashed #000;
      padding: 8px;
      margin-top: 8px;
      text-align: center;
      font-size: 16px;
      font-weight: 700;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 4px 2px;
      vertical-align: top;
      border-bottom: 1px dashed #999;
      text-align: right;
    }

    th { font-size: 11px; }

    .totals {
      margin-top: 8px;
      display: grid;
      gap: 4px;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .grand-total {
      font-weight: 700;
      font-size: 14px;
    }

    .thanks {
      margin-top: 10px;
      text-align: center;
      font-size: 11px;
    }

    @media print {
      @page {
        size: 80mm auto;
        margin: 0;
      }

      .receipt {
        width: 80mm;
      }
    }
  `;
}

receiptsRoute.get("/sales/:id", async (c) => {
  const id = c.req.param("id");

  const setting = await getSetting();

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      currency: true,
      items: {
        include: {
          product: true,
          unit: true,
          lot: true,
          warehouse: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  return c.json({
    data: {
      setting,
      sale,
    },
  });
});

receiptsRoute.get("/sales/:id/html", async (c) => {
  const id = c.req.param("id");

  const setting = await getSetting();

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      currency: true,
      items: {
        include: {
          product: true,
          unit: true,
          lot: true,
          warehouse: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!sale) {
    return c.html("<h1>Sale not found</h1>", 404);
  }

  const currency = sale.currency.symbol || sale.currency.code;

  const rows = sale.items
    .map((item, index) => {
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div>${escapeHtml(item.product.name)}</div>
            ${
              item.expiryDate
                ? `<small>تاریخ انقضا: ${escapeHtml(formatDate(item.expiryDate))}</small>`
                : ""
            }
          </td>
          <td>${formatNumber(item.quantity)} ${escapeHtml(item.unit.shortName || item.unit.name)}</td>
          <td>${formatNumber(item.unitPrice)}</td>
          <td>${formatNumber(item.totalPrice)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>رسید فروش ${escapeHtml(sale.invoiceNo || sale.id)}</title>
  <style>${receiptCss()}</style>
</head>
<body>
  <div class="receipt">
    ${receiptHeader(setting)}

    <div class="line"></div>
    <div class="title">رسید فروش</div>

    <div class="meta">
      <div>شماره رسید: ${escapeHtml(sale.invoiceNo || sale.id)}</div>
      <div>تاریخ: ${escapeHtml(formatDate(sale.saleDate))}</div>
      <div>مشتری: ${escapeHtml(sale.customer?.name || "مشتری نقدی")}</div>
      <div>وضعیت پرداخت: ${escapeHtml(sale.paymentStatus)}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>جنس</th>
          <th>تعداد</th>
          <th>قیمت</th>
          <th>جمع</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="totals">
      <div class="total-row">
        <span>جمع کل اجناس</span>
        <span>${formatNumber(sale.subtotal)} ${escapeHtml(currency)}</span>
      </div>
      <div class="total-row">
        <span>تخفیف</span>
        <span>${formatNumber(sale.discount)} ${escapeHtml(currency)}</span>
      </div>
      <div class="total-row grand-total">
        <span>مبلغ نهایی</span>
        <span>${formatNumber(sale.total)} ${escapeHtml(currency)}</span>
      </div>
      <div class="total-row">
        <span>پرداخت شده</span>
        <span>${formatNumber(sale.paidAmount)} ${escapeHtml(currency)}</span>
      </div>
      <div class="total-row">
        <span>باقی</span>
        <span>${formatNumber(sale.remainingAmount)} ${escapeHtml(currency)}</span>
      </div>
    </div>

    ${receiptFooter(setting)}
  </div>
</body>
</html>
  `;

  return c.html(html);
});

receiptsRoute.get("/party-payments/:id", async (c) => {
  const id = c.req.param("id");

  const setting = await getSetting();

  const partyTransaction = await prisma.partyTransaction.findUnique({
    where: { id },
    include: {
      party: true,
      currency: true,
    },
  });

  if (!partyTransaction) {
    return c.json({ message: "Payment transaction not found" }, 404);
  }

  const moneyTransaction = await prisma.moneyTransaction.findFirst({
    where: {
      referenceId: partyTransaction.id,
    },
    include: {
      cashRegisterAccount: {
        include: {
          cashRegister: true,
          currency: true,
        },
      },
      bankAccount: {
        include: {
          currency: true,
        },
      },
    },
  });

  return c.json({
    data: {
      setting,
      partyTransaction,
      moneyTransaction,
    },
  });
});

receiptsRoute.get("/party-payments/:id/html", async (c) => {
  const id = c.req.param("id");

  const setting = await getSetting();

  const partyTransaction = await prisma.partyTransaction.findUnique({
    where: { id },
    include: {
      party: true,
      currency: true,
    },
  });

  if (!partyTransaction) {
    return c.html("<h1>Payment transaction not found</h1>", 404);
  }

  const moneyTransaction = await prisma.moneyTransaction.findFirst({
    where: {
      referenceId: partyTransaction.id,
    },
    include: {
      cashRegisterAccount: {
        include: {
          cashRegister: true,
          currency: true,
        },
      },
      bankAccount: {
        include: {
          currency: true,
        },
      },
    },
  });

  const currency =
    partyTransaction.currency.symbol || partyTransaction.currency.code;

  const isCustomerPayment =
    partyTransaction.type === PartyTransactionType.PAYMENT_RECEIVED;

  const title = isCustomerPayment
    ? "رسید دریافت پول از مشتری"
    : "رسید پرداخت پول به تامین‌کننده";

  const accountName = moneyTransaction?.cashRegisterAccount
    ? `صندوق: ${moneyTransaction.cashRegisterAccount.cashRegister.name}`
    : moneyTransaction?.bankAccount
      ? `بانک: ${moneyTransaction.bankAccount.name}`
      : "ثبت نشده";

  const html = `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} ${escapeHtml(partyTransaction.id)}</title>
  <style>${receiptCss()}</style>
</head>
<body>
  <div class="receipt">
    ${receiptHeader(setting)}

    <div class="line"></div>
    <div class="title">${escapeHtml(title)}</div>

    <div class="meta">
      <div>شماره رسید: ${escapeHtml(partyTransaction.id)}</div>
      <div>تاریخ: ${escapeHtml(formatDate(partyTransaction.createdAt))}</div>
      <div>نام: ${escapeHtml(partyTransaction.party.name)}</div>
      <div>شماره تماس: ${escapeHtml(partyTransaction.party.phone || "-")}</div>
      <div>حساب دریافت/پرداخت: ${escapeHtml(accountName)}</div>
      <div>توضیحات: ${escapeHtml(partyTransaction.note || "-")}</div>
    </div>

    <div class="total-box">
      مبلغ: ${formatNumber(partyTransaction.amount)} ${escapeHtml(currency)}
    </div>

    ${receiptFooter(setting)}
  </div>
</body>
</html>
  `;

  return c.html(html);
});
