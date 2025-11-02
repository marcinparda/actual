// Receipt API functions for communicating with sync server
import { fetch } from '../platform/server/fetch';
import * as Platform from '../shared/platform';
import type {
  ReceiptExpense,
  ReceiptProcessResult,
  ReceiptUploadResponse,
} from '../types/models/receipt';
import type { CategoryEntity } from '../types/models';

/**
 * Upload a receipt image to the sync server
 * @param file - The file to upload (File or Blob)
 * @param serverUrl - The sync server URL
 * @returns Upload response with fileId and path
 */
export async function uploadReceipt(
  file: File | Blob,
  serverUrl: string,
): Promise<ReceiptUploadResponse> {
  const formData = new FormData();
  formData.append('receipt', file);

  try {
    const response = await fetch(`${serverUrl}/receipt/upload`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header - browser will set it with boundary for multipart/form-data
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.message || `Upload failed: ${response.statusText}`,
      );
    }

    const result = await response.json();

    if (result.status !== 'ok') {
      throw new Error(result.message || 'Upload failed');
    }

    return result.data as ReceiptUploadResponse;
  } catch (error) {
    throw new Error(
      `Failed to upload receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Process a receipt image with OpenAI OCR
 * @param fileId - The uploaded file ID
 * @param categories - List of available categories
 * @param serverUrl - The sync server URL
 * @returns Processed receipt data with extracted expenses
 */
export async function processReceipt(
  fileId: string,
  categories: CategoryEntity[],
  serverUrl: string,
): Promise<ReceiptProcessResult> {
  try {
    const response = await fetch(`${serverUrl}/receipt/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
        categories: categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          is_income: cat.is_income,
        })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.message || `Processing failed: ${response.statusText}`,
      );
    }

    const result = await response.json();

    if (result.status !== 'ok') {
      throw new Error(result.message || 'Processing failed');
    }

    return result.data as ReceiptProcessResult;
  } catch (error) {
    throw new Error(
      `Failed to process receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Get the URL for a receipt image
 * @param fileId - The file ID
 * @param serverUrl - The sync server URL
 * @returns The full URL to the receipt image
 */
export function getReceiptUrl(fileId: string, serverUrl: string): string {
  return `${serverUrl}/receipt/${fileId}`;
}

/**
 * Delete a receipt image from the sync server
 * @param fileId - The file ID to delete
 * @param serverUrl - The sync server URL
 */
export async function deleteReceipt(
  fileId: string,
  serverUrl: string,
): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/receipt/${fileId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.message || `Delete failed: ${response.statusText}`,
      );
    }

    const result = await response.json();

    if (result.status !== 'ok') {
      throw new Error(result.message || 'Delete failed');
    }
  } catch (error) {
    throw new Error(
      `Failed to delete receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Check if receipt processing is available (OpenAI API key configured)
 * This can be determined by attempting a small test or checking server config
 */
export async function isReceiptProcessingAvailable(
  serverUrl: string,
): Promise<boolean> {
  // For now, we'll assume it's available if the sync server is reachable
  // In the future, we could add a /receipt/status endpoint to check
  try {
    const response = await fetch(`${serverUrl}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}
