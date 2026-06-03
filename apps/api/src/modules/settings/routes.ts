import { Hono } from "hono";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, verifyPassword, writeAudit } from "../../lib/auth";
import {
  ensureRuntimeServerConfigFile,
  getRuntimeServerConfig,
  updateRuntimeServerConfig
} from "../../lib/runtime-server-config";
import { pruneOldBackups } from "../backups/service";
import { resetStoreData } from "../../lib/system-reset";

export const settingsRoute = new Hono();

const updateCompanySettingSchema = z.object({
  companyName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(80).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  defaultCurrencyId: z.string().trim().optional().nullable(),
  logoImage: z.string().trim().optional().nullable(),
  receiptHeaderImage: z.string().trim().optional().nullable(),
  receiptFooterImage: z.string().trim().optional().nullable()
});

const updateServerSettingSchema = z.object({
  backupDir: z.string().trim().min(3).max(500),
  backupRetentionCount: z.coerce.number().int().min(1).max(365)
});

const resetSystemSchema = z.object({
  password: z.string().min(1),
  confirmation: z.literal("RESET MUHASEB")
});

async function getOrCreateCompanySetting() {
  const existing = await prisma.companySetting.findFirst({
    orderBy: {
      createdAt: "asc"
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.companySetting.create({
    data: {
      companyName: "Supermarket"
    }
  });
}

settingsRoute.get("/company", async (c) => {
  const setting = await getOrCreateCompanySetting();

  return c.json({ data: setting });
});

settingsRoute.patch("/company", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateCompanySettingSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const current = await getOrCreateCompanySetting();

  const updated = await prisma.companySetting.update({
    where: {
      id: current.id
    },
    data: parsed.data
  });

  return c.json({ data: updated });
});

settingsRoute.get("/server", async (c) => {
  await ensureRuntimeServerConfigFile();
  return c.json({ data: getRuntimeServerConfig() });
});

settingsRoute.patch("/server", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateServerSettingSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);
  if (!path.isAbsolute(parsed.data.backupDir)) {
    return c.json({ message: "Backup directory must be an absolute path" }, 400);
  }

  await mkdir(parsed.data.backupDir, { recursive: true });
  const updated = await updateRuntimeServerConfig(parsed.data);
  await pruneOldBackups();
  await writeAudit(c, {
    action: "settings.server.update",
    entityType: "ServerSetting",
    description: "Backup runtime settings updated",
    metadata: updated
  });
  return c.json({ data: updated });
});

settingsRoute.post("/reset-system", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser || authUser.role !== "Admin") {
    return c.json({ message: "فقط Admin می‌تواند تمام اطلاعات سیستم را ریست کند" }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = resetSystemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ message: "عبارت تایید RESET MUHASEB و رمز عبور Admin لازم است" }, 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { passwordHash: true }
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return c.json({ message: "رمز عبور Admin درست نیست" }, 401);
  }

  const result = await resetStoreData(authUser.id);
  return c.json({
    message: "اطلاعات سیستم ریست شد؛ دوباره وارد شوید",
    data: result
  });
});

settingsRoute.post("/receipt-image", async (c) => {
  const body = await c.req.parseBody();

  const type = body["type"];
  const file = body["file"] as any;

  if (type !== "logo" && type !== "header" && type !== "footer") {
    return c.json(
      {
        message: "type must be logo, header or footer"
      },
      400
    );
  }

  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return c.json(
      {
        message: "Image file is required"
      },
      400
    );
  }

  const mimeType = String(file.type || "");

  if (!mimeType.startsWith("image/")) {
    return c.json(
      {
        message: "Only image files are allowed"
      },
      400
    );
  }

  const uploadDir = path.join(process.cwd(), "uploads", "receipts");
  await mkdir(uploadDir, { recursive: true });

  const originalName = String(file.name || "receipt-image.png");
  const extFromName = path.extname(originalName).toLowerCase();
  const ext =
    extFromName ||
    (mimeType === "image/png"
      ? ".png"
      : mimeType === "image/jpeg"
        ? ".jpg"
        : mimeType === "image/webp"
          ? ".webp"
          : ".png");

  const filename = `${type}-${Date.now()}${ext}`;
  const filePath = path.join(uploadDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const publicPath = `/uploads/receipts/${filename}`;

  const current = await getOrCreateCompanySetting();

  const updated = await prisma.companySetting.update({
    where: {
      id: current.id
    },
    data:
      type === "logo"
        ? { logoImage: publicPath }
        : type === "header"
          ? { receiptHeaderImage: publicPath }
          : { receiptFooterImage: publicPath }
  });

  return c.json({
    data: {
      setting: updated,
      imageUrl: publicPath
    }
  });
});
