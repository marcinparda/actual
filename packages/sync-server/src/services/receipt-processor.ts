import fs from 'node:fs';
import path from 'node:path';
import createDebug from 'debug';
import OpenAI from 'openai';
import { config } from '../load-config.js';

const debug = createDebug('actual:receipt-processor');

export interface Category {
  id: string;
  name: string;
  is_income?: boolean;
}

export interface ReceiptExpense {
  amount: number; // In cents (integer)
  merchant: string;
  date: string; // ISO date format YYYY-MM-DD
  categoryId: string | null;
  categoryName: string;
  note: string; // Description of items (e.g., "groceries", "milk, eggs, bread")
  confidence: number; // 0.0 to 1.0
}

export interface ReceiptProcessResult {
  expenses: ReceiptExpense[];
  totalAmount: number; // In cents
  receiptDate: string | null;
  merchant: string | null;
  confidence: number;
  rawResponse?: string;
}

/**
 * Process a receipt image using OpenAI GPT-4o mini Vision API
 * @param imagePath - Path to the receipt image file
 * @param categories - List of available categories to match against
 * @returns Processed receipt data with extracted expenses
 */
export async function processReceipt(
  imagePath: string,
  categories: Category[],
): Promise<ReceiptProcessResult> {
  const apiKey = config.get('openai.apiKey');
  const model = config.get('openai.model');

  if (!apiKey) {
    throw new Error(
      'OpenAI API key not configured. Set ACTUAL_OPENAI_API_KEY environment variable.',
    );
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Receipt image not found: ${imagePath}`);
  }

  debug(`Processing receipt: ${imagePath}`);
  debug(`Using model: ${model}`);
  debug(`Available categories: ${categories.length}`);

  // Initialize OpenAI client
  const openai = new OpenAI({ apiKey });

  // Read and encode image to base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = getMimeType(ext);

  // Build category list for the prompt
  const categoryList = categories
    .map(cat => `- ${cat.name} (id: ${cat.id})`)
    .join('\n');

  // Construct the prompt
  const prompt = `You are a receipt OCR system. Analyze this receipt image and extract transaction information.

AVAILABLE CATEGORIES:
${categoryList}

CRITICAL CATEGORIZATION RULES:
1. Carefully analyze EACH item on the receipt and categorize it correctly between AVAILABLE CATEGORIES
2. Analyze items INDIVIDUALLY based on their type, not just based on being purchased together, e.g., separate food from household items, they are often on the same receipt

GROUPING INSTRUCTIONS:
1. Create separate expenses for DIFFERENT types of items (e.g., one for food, one for household items)
2. Within each category, combine similar items into ONE expense
3. For the "note" field, provide a list of EVERY item included in that expense

AMOUNT CONVERSION:
- Convert currency amounts to cents (multiply by 100)
- For Polish złoty (PLN/zł), multiply by 100: 141.76 PLN = 14176 cents
- For dollars ($), multiply by 100: $50.25 = 5025 cents

DATE FORMAT:
- Extract date in YYYY-MM-DD format
- For example: "2022-01-25" from receipt

OUTPUT FORMAT (valid JSON only):
{
  "merchant": "Store Name",
  "date": "YYYY-MM-DD",
  "totalAmount": 14176,
  "expenses": [
    {
      "amount": 12000,
      "categoryId": "groceries-cat-id",
      "categoryName": "Groceries",
      "note": "weekly food shopping",
      "confidence": 0.95
    },
    {
      "amount": 2176,
      "categoryId": "household-cat-id",
      "categoryName": "Household",
      "note": "paper products and cleaning supplies",
      "confidence": 0.90
    }
  ],
  "confidence": 0.92
}

IMPORTANT: Return ONLY valid JSON, no additional text or explanation.`;

  try {
    debug('Calling OpenAI Vision API...');
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.1, // Low temperature for more consistent extraction
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI API');
    }

    debug('OpenAI response received');
    debug(`Raw response: ${content}`);

    // Parse JSON response
    let parsedData;
    try {
      // Try to extract JSON from response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      parsedData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      debug(`Failed to parse OpenAI response: ${parseError}`);
      throw new Error(
        `Failed to parse receipt data: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      );
    }

    // Validate and normalize the response
    const result: ReceiptProcessResult = {
      expenses: parsedData.expenses || [],
      totalAmount: parsedData.totalAmount || 0,
      receiptDate: parsedData.date || null,
      merchant: parsedData.merchant || null,
      confidence: parsedData.confidence || 0.5,
      rawResponse: content,
    };

    // Ensure all expenses have required fields
    result.expenses = result.expenses.map((expense: ReceiptExpense) => ({
      amount: expense.amount || 0,
      merchant: parsedData.merchant || expense.merchant || '',
      date:
        expense.date ||
        parsedData.date ||
        new Date().toISOString().split('T')[0],
      categoryId: expense.categoryId || null,
      categoryName: expense.categoryName || 'Uncategorized',
      note: expense.note || '',
      confidence: expense.confidence || 0.5,
    }));

    debug(`Successfully extracted ${result.expenses.length} expense(s)`);
    return result;
  } catch (error) {
    debug(`Error processing receipt: ${error}`);
    if (error instanceof Error) {
      throw new Error(`Receipt processing failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get MIME type from file extension
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };

  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Validate receipt image file
 */
export function validateReceiptImage(
  filePath: string,
  maxSizeMB: number,
): { valid: boolean; error?: string } {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: 'File does not exist' };
  }

  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);

  if (fileSizeMB > maxSizeMB) {
    return {
      valid: false,
      error: `File size ${fileSizeMB.toFixed(2)}MB exceeds maximum ${maxSizeMB}MB`,
    };
  }

  const ext = path.extname(filePath).toLowerCase();
  const validExtensions = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.heic',
    '.heif',
  ];

  if (!validExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file type. Supported: ${validExtensions.join(', ')}`,
    };
  }

  return { valid: true };
}
