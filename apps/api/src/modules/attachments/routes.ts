import { access, mkdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import sharp from "sharp";
import { prisma } from "../../lib/prisma";
import { getAuthUser } from "../../lib/auth";
import { zodError } from "../../lib/api";

export const attachmentsRoute = new Hono();

const querySchema = z.object({
  entityType: z.string().trim().min(2).max(80),
  entityId: z.string().trim().min(2).max(120)
});

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function safeEntityType(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function extensionFor(mimeType: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  if ([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    return ext;
  }

  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".bin";
}

attachmentsRoute.get("/", async (c) => {
  const parsed = querySchema.safeParse({
    entityType: c.req.query("entityType"),
    entityId: c.req.query("entityId")
  });

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const data = await prisma.documentAttachment.findMany({
    where: {
      ...parsed.data,
      deletedAt: null
    },
    include: {
      createdByUser: {
        select: {
          id: true,
          username: true,
          displayName: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return c.json({ data });
});

attachmentsRoute.post("/", async (c) => {
  const body = await c.req.parseBody();
  const entityType = String(body.entityType || "");
  const entityId = String(body.entityId || "");
  const note = String(body.note || "").trim() || null;
  const parsed = querySchema.safeParse({ entityType, entityId });

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const file = body.file as any;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return c.json({ message: "فایل سند ضروری است" }, 400);
  }

  const mimeType = String(file.type || "");
  if (!allowedMimeTypes.has(mimeType)) {
    return c.json({ message: "فقط عکس یا PDF قابل آپلود است" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxSize = 10 * 1024 * 1024;
  if (buffer.byteLength > maxSize) {
    return c.json({ message: "حجم فایل باید کمتر از ۱۰MB باشد" }, 400);
  }

  const safeType = safeEntityType(parsed.data.entityType);
  const uploadDir = path.join(process.cwd(), "uploads", "documents", safeType);
  await mkdir(uploadDir, { recursive: true });

  const originalName = String(file.name || "document");
  const ext = extensionFor(mimeType, originalName);
  const fileName = `${parsed.data.entityId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, buffer);

  const url = `/uploads/documents/${safeType}/${fileName}`;
  if (mimeType.startsWith("image/")) {
    const thumbnailDir = path.join(process.cwd(), "uploads", "thumbnails", safeType);
    await mkdir(thumbnailDir, { recursive: true });
    await sharp(buffer)
      .rotate()
      .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toFile(path.join(thumbnailDir, `${fileName}.webp`));
  }
  const authUser = getAuthUser(c);

  const data = await prisma.documentAttachment.create({
    data: {
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      originalName,
      fileName,
      mimeType,
      sizeBytes: buffer.byteLength,
      url,
      note,
      createdByUserId: authUser?.id
    },
    include: {
      createdByUser: {
        select: {
          id: true,
          username: true,
          displayName: true
        }
      }
    }
  });

  return c.json({ data }, 201);
});

attachmentsRoute.get("/:id/download", async (c) => {
  const attachment = await prisma.documentAttachment.findUnique({ where: { id: c.req.param("id") } });
  if (!attachment || attachment.deletedAt) return c.json({ message: "Attachment not found" }, 404);
  const relative = attachment.url.replace(/^\/uploads\//, "");
  const filePath = path.resolve(process.cwd(), "uploads", relative);
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  if (!filePath.startsWith(uploadsRoot)) return c.json({ message: "Invalid attachment path" }, 400);
  try {
    await access(filePath);
  } catch {
    return c.json({ message: "Attachment file not found" }, 404);
  }
  c.header("Content-Type", attachment.mimeType);
  c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
  return stream(c, async (output) => {
    for await (const chunk of createReadStream(filePath)) await output.write(chunk);
  });
});

attachmentsRoute.get("/:id/thumbnail", async (c) => {
  const attachment = await prisma.documentAttachment.findUnique({ where: { id: c.req.param("id") } });
  if (!attachment || attachment.deletedAt || !attachment.mimeType.startsWith("image/")) {
    return c.json({ message: "Thumbnail not found" }, 404);
  }
  const safeType = safeEntityType(attachment.entityType);
  const filePath = path.join(process.cwd(), "uploads", "thumbnails", safeType, `${attachment.fileName}.webp`);
  try {
    await access(filePath);
  } catch {
    return c.json({ message: "Thumbnail not found" }, 404);
  }
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "private, max-age=86400");
  return stream(c, async (output) => {
    for await (const chunk of createReadStream(filePath)) await output.write(chunk);
  });
});

attachmentsRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const data = await prisma.documentAttachment.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedByUserId: authUser?.id
    }
  });

  return c.json({ data });
});
