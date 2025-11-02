import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import createDebug from 'debug';
import { config } from './load-config.js';
import {
  processReceipt,
  validateReceiptImage,
  type Category,
} from './services/receipt-processor.js';
import { needsBootstrap } from './account-db.js';

const debug = createDebug('actual:receipt');

export const handlers = express.Router();

// Ensure receipt storage directory exists
const receiptStoragePath = config.get('receipt.storagePath');
if (!fs.existsSync(receiptStoragePath)) {
  debug(`Creating receipt storage directory: ${receiptStoragePath}`);
  fs.mkdirSync(receiptStoragePath, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, receiptStoragePath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp_uuid.ext
    const ext = path.extname(file.originalname);
    const timestamp = Date.now();
    const uuid = crypto.randomUUID();
    const userId = (req as any).user?.user_id || 'anonymous';
    const filename = `${timestamp}_${userId}_${uuid}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.get('receipt.maxSizeMB') * 1024 * 1024, // Convert MB to bytes
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedMimes.join(', ')}`));
    }
  },
});

/**
 * POST /receipt/upload
 * Upload a receipt image file
 */
handlers.post('/upload', upload.single('receipt'), async (req: Request, res: Response) => {
  try {
    const bootstrap = await needsBootstrap();
    if (bootstrap) {
      res.status(500).send({
        status: 'error',
        reason: 'not-bootstrapped',
      });
      return;
    }

    if (!req.file) {
      res.status(400).send({
        status: 'error',
        reason: 'no-file',
        message: 'No receipt file provided',
      });
      return;
    }

    const filePath = req.file.path;
    const fileId = path.basename(filePath, path.extname(filePath));
    const maxSizeMB = config.get('receipt.maxSizeMB');

    debug(`Receipt uploaded: ${filePath}`);

    // Validate the uploaded file
    const validation = validateReceiptImage(filePath, maxSizeMB);
    if (!validation.valid) {
      // Delete invalid file
      fs.unlinkSync(filePath);
      res.status(400).send({
        status: 'error',
        reason: 'invalid-file',
        message: validation.error,
      });
      return;
    }

    res.status(200).send({
      status: 'ok',
      data: {
        fileId,
        filename: req.file.filename,
        size: req.file.size,
        path: `/receipt/${fileId}`,
      },
    });
  } catch (error) {
    debug(`Upload error: ${error}`);
    res.status(500).send({
      status: 'error',
      reason: 'upload-failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /receipt/process
 * Process an uploaded receipt with OpenAI
 */
handlers.post('/process', express.json(), async (req: Request, res: Response) => {
  try {
    const bootstrap = await needsBootstrap();
    if (bootstrap) {
      res.status(500).send({
        status: 'error',
        reason: 'not-bootstrapped',
      });
      return;
    }

    const { fileId, categories } = req.body;

    if (!fileId) {
      res.status(400).send({
        status: 'error',
        reason: 'missing-file-id',
        message: 'fileId is required',
      });
      return;
    }

    if (!categories || !Array.isArray(categories)) {
      res.status(400).send({
        status: 'error',
        reason: 'missing-categories',
        message: 'categories array is required',
      });
      return;
    }

    // Find the receipt file
    const files = fs.readdirSync(receiptStoragePath);
    const receiptFile = files.find((f) => f.startsWith(`${fileId}.`) || f.includes(`_${fileId}.`));

    if (!receiptFile) {
      res.status(404).send({
        status: 'error',
        reason: 'file-not-found',
        message: `Receipt file not found: ${fileId}`,
      });
      return;
    }

    const filePath = path.join(receiptStoragePath, receiptFile);

    debug(`Processing receipt: ${filePath}`);
    debug(`Categories provided: ${categories.length}`);

    // Process the receipt
    const result = await processReceipt(filePath, categories as Category[]);

    const fileExtension = path.extname(receiptFile);

    res.status(200).send({
      status: 'ok',
      data: {
        ...result,
        receiptUrl: `/receipt/${fileId}`,
        fileId,
        filename: receiptFile,
        extension: fileExtension,
      },
    });
  } catch (error) {
    debug(`Process error: ${error}`);
    res.status(500).send({
      status: 'error',
      reason: 'processing-failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /receipt/:fileId
 * Retrieve a receipt image
 */
handlers.get('/:fileId', async (req: Request, res: Response) => {
  try {
    const bootstrap = await needsBootstrap();
    if (bootstrap) {
      res.status(500).send({
        status: 'error',
        reason: 'not-bootstrapped',
      });
      return;
    }

    const { fileId } = req.params;

    if (!fileId) {
      res.status(400).send({
        status: 'error',
        reason: 'missing-file-id',
        message: 'fileId is required',
      });
      return;
    }

    // Find the receipt file (with any extension)
    const files = fs.readdirSync(receiptStoragePath);
    const receiptFile = files.find((f) => {
      // Match files that start with fileId. or contain _fileId.
      const nameWithoutExt = path.basename(f, path.extname(f));
      return nameWithoutExt === fileId || nameWithoutExt.includes(`_${fileId}`);
    });

    if (!receiptFile) {
      res.status(404).send({
        status: 'error',
        reason: 'file-not-found',
        message: `Receipt file not found: ${fileId}`,
      });
      return;
    }

    const filePath = path.join(receiptStoragePath, receiptFile);

    if (!fs.existsSync(filePath)) {
      res.status(404).send({
        status: 'error',
        reason: 'file-not-found',
        message: 'Receipt file not found',
      });
      return;
    }

    debug(`Serving receipt: ${filePath}`);

    // Set appropriate content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400'); // Cache for 24 hours

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    debug(`Retrieval error: ${error}`);
    res.status(500).send({
      status: 'error',
      reason: 'retrieval-failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /receipt/:fileId
 * Delete a receipt image
 */
handlers.delete('/:fileId', async (req: Request, res: Response) => {
  try {
    const bootstrap = await needsBootstrap();
    if (bootstrap) {
      res.status(500).send({
        status: 'error',
        reason: 'not-bootstrapped',
      });
      return;
    }

    const { fileId } = req.params;

    if (!fileId) {
      res.status(400).send({
        status: 'error',
        reason: 'missing-file-id',
        message: 'fileId is required',
      });
      return;
    }

    // Find and delete the receipt file
    const files = fs.readdirSync(receiptStoragePath);
    const receiptFile = files.find((f) => {
      const nameWithoutExt = path.basename(f, path.extname(f));
      return nameWithoutExt === fileId || nameWithoutExt.includes(`_${fileId}`);
    });

    if (!receiptFile) {
      res.status(404).send({
        status: 'error',
        reason: 'file-not-found',
        message: `Receipt file not found: ${fileId}`,
      });
      return;
    }

    const filePath = path.join(receiptStoragePath, receiptFile);
    fs.unlinkSync(filePath);

    debug(`Deleted receipt: ${filePath}`);

    res.status(200).send({
      status: 'ok',
      message: 'Receipt deleted successfully',
    });
  } catch (error) {
    debug(`Delete error: ${error}`);
    res.status(500).send({
      status: 'error',
      reason: 'delete-failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
