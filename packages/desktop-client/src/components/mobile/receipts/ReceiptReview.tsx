import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import {
  SvgTrash,
  SvgRefresh,
  SvgCheckmark,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { theme } from '@actual-app/components/theme';

import {
  uploadReceipt,
  processReceipt,
  getReceiptUrl,
  deleteReceipt,
} from 'loot-core/server/receipt-api';
import { send } from 'loot-core/platform/client/fetch';
import {
  integerToCurrency,
  integerToAmount,
  amountToInteger,
} from 'loot-core/shared/util';
import type {
  ReceiptExpense,
  ReceiptProcessResult,
} from 'loot-core/types/models/receipt';
import type { CategoryEntity, AccountEntity } from 'loot-core/types/models';

import { MobileBackButton } from '@desktop-client/components/mobile/MobileBackButton';
import {
  FieldLabel,
  TapField,
  InputField,
} from '@desktop-client/components/mobile/MobileForms';
import { MobilePageHeader, Page } from '@desktop-client/components/Page';
import { AmountInput } from '@desktop-client/components/util/AmountInput';
import { useAccounts } from '@desktop-client/hooks/useAccounts';
import { useCategories } from '@desktop-client/hooks/useCategories';
import { useDateFormat } from '@desktop-client/hooks/useDateFormat';
import { useNavigate } from '@desktop-client/hooks/useNavigate';
import { usePayees } from '@desktop-client/hooks/usePayees';
import { pushModal } from '@desktop-client/modals/modalsSlice';
import { useDispatch, useSelector } from '@desktop-client/redux';
import { useServerURL } from '@desktop-client/components/ServerContext';

interface EditableExpense extends ReceiptExpense {
  id: string;
  account?: string;
  payee?: string;
}

export function ReceiptReview() {
  const { fileId } = useParams<{ fileId: string }>();
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';

  const accounts = useAccounts();
  const { list: categories } = useCategories();
  const payees = usePayees();

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string>('');
  const [expenses, setExpenses] = useState<EditableExpense[]>([]);
  const [fullReceiptUrl, setFullReceiptUrl] = useState<string>('');

  // Get sync server URL from local storage or config
  const serverUrl = useServerURL();

  const processReceiptFile = useCallback(async () => {
    if (!fileId) return;

    setProcessing(true);
    setError(null);

    try {
      const result = await processReceipt(fileId, categories, serverUrl);

      // Convert to editable expenses with default account
      const editableExpenses: EditableExpense[] = result.expenses.map(
        (expense, index) => ({
          ...expense,
          id: `expense-${index}`,
          account: accountId || undefined,
          payee: undefined, // Will be filled in by user or auto-created
        }),
      );

      setExpenses(editableExpenses);
      setReceiptUrl(result.receiptUrl);

      // Construct full URL with server URL and extension
      const fullUrl = `${serverUrl}${result.receiptUrl}${result.extension}`;
      setFullReceiptUrl(fullUrl);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to process receipt. Please try again.',
      );
    } finally {
      setProcessing(false);
      setLoading(false);
    }
  }, [fileId, categories, serverUrl, accountId]);

  useEffect(() => {
    if (fileId && serverUrl) {
      setReceiptUrl(getReceiptUrl(fileId, serverUrl));
      processReceiptFile();
    } else {
      setError('Invalid receipt or server configuration');
      setLoading(false);
    }
  }, [fileId, serverUrl, processReceiptFile]);

  const handleRetry = async () => {
    await processReceiptFile();
  };

  const handleCancel = async () => {
    // Delete the receipt and navigate back
    if (fileId && serverUrl) {
      try {
        await deleteReceipt(fileId, serverUrl);
      } catch (err) {
        console.error('Failed to delete receipt:', err);
      }
    }
    navigate(-1);
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      // Create transactions from expenses
      const transactionsToAdd = [];

      for (const expense of expenses) {
        if (!expense.account) {
          throw new Error('All expenses must have an account');
        }

        // Create or find payee
        let payeeId = expense.payee;
        if (!payeeId && expense.merchant) {
          // Try to find existing payee by name
          const existingPayee = payees.find(
            p => p.name.toLowerCase() === expense.merchant.toLowerCase(),
          );

          if (existingPayee) {
            payeeId = existingPayee.id;
          } else {
            // Create new payee
            const newPayee = await send('payee-create', {
              name: expense.merchant,
            });
            payeeId = newPayee.id;
          }
        }

        const transaction = {
          id: `temp-${Date.now()}-${Math.random()}`,
          account: expense.account,
          date: expense.date,
          amount: expense.amount,
          payee: payeeId,
          category: expense.categoryId,
          notes: fullReceiptUrl,
          cleared: false,
        };

        transactionsToAdd.push(transaction);
      }

      // Batch add transactions
      await send('transactions-batch-update', {
        added: transactionsToAdd,
        updated: [],
        deleted: [],
      });

      // Navigate to account page
      const targetAccountId = accountId || expenses[0]?.account;
      if (targetAccountId) {
        navigate(`/accounts/${targetAccountId}`);
      } else {
        navigate(-1);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save transactions. Please try again.',
      );
      setLoading(false);
    }
  };

  const updateExpense = (id: string, field: string, value: any) => {
    setExpenses(prev =>
      prev.map(expense =>
        expense.id === id ? { ...expense, [field]: value } : expense,
      ),
    );
  };

  const openCategoryModal = (expenseId: string) => {
    dispatch(
      pushModal({
        modal: {
          name: 'category-autocomplete',
          options: {
            onSelect: (categoryId: string) => {
              const category = categories.find(c => c.id === categoryId);
              if (category) {
                updateExpense(expenseId, 'categoryId', categoryId);
                updateExpense(expenseId, 'categoryName', category.name);
              }
            },
          },
        },
      }),
    );
  };

  const openAccountModal = (expenseId: string) => {
    dispatch(
      pushModal({
        modal: {
          name: 'account-autocomplete',
          options: {
            onSelect: (accountId: string) => {
              updateExpense(expenseId, 'account', accountId);
            },
          },
        },
      }),
    );
  };

  const openPayeeModal = (expenseId: string) => {
    dispatch(
      pushModal({
        modal: {
          name: 'payee-autocomplete',
          options: {
            onSelect: (payeeId: string) => {
              updateExpense(expenseId, 'payee', payeeId);
            },
          },
        },
      }),
    );
  };

  if (loading || processing) {
    return (
      <Page
        title="Processing Receipt"
        header={
          <MobilePageHeader
            title="Processing Receipt"
            leftContent={<MobileBackButton />}
          />
        }
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
          }}
        >
          <Text style={{ fontSize: 16, marginBottom: 10 }}>
            {processing ? 'Reading receipt...' : 'Loading...'}
          </Text>
          <Text style={{ color: theme.pageTextSubdued, textAlign: 'center' }}>
            This may take a few moments
          </Text>
        </View>
      </Page>
    );
  }

  if (error) {
    return (
      <Page
        title="Receipt Error"
        header={
          <MobilePageHeader
            title="Receipt Error"
            leftContent={<MobileBackButton />}
          />
        }
      >
        <View style={{ flex: 1, padding: 20 }}>
          <Text style={{ color: theme.errorText, marginBottom: 20 }}>
            {error}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button onPress={handleRetry} style={{ flex: 1 }}>
              <SvgRefresh style={{ width: 16, height: 16, marginRight: 5 }} />
              Retry
            </Button>
            <Button onPress={handleCancel} style={{ flex: 1 }}>
              Cancel
            </Button>
          </View>
        </View>
      </Page>
    );
  }

  const canSave = expenses.length > 0 && expenses.every(e => e.account);

  return (
    <Page
      title="Review Receipt"
      header={
        <MobilePageHeader
          title="Review Receipt"
          leftContent={<MobileBackButton />}
        />
      }
    >
      <View style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Scrollable Content */}
        <View
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 15,
          }}
        >
          {/* Receipt Image Preview */}
          {receiptUrl && (
            <View
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <View
                style={{
                  width: '100%',
                  maxWidth: 300,
                  backgroundColor: theme.tableBackground,
                  borderRadius: 8,
                  border: `1px solid ${theme.tableBorder}`,
                  overflow: 'hidden',
                }}
              >
                <img
                  src={receiptUrl}
                  alt="Receipt"
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                  }}
                />
              </View>
            </View>
          )}

          {/* Expenses List */}
          <Text
            style={{
              fontWeight: 600,
              fontSize: 16,
              marginBottom: 10,
            }}
          >
            Detected Expenses ({expenses.length})
          </Text>

          {expenses.map((expense, index) => {
            const account = accounts.find(a => a.id === expense.account);
            const category = categories.find(c => c.id === expense.categoryId);
            const payee = payees.find(p => p.id === expense.payee);

            return (
              <View
                key={expense.id}
                style={{
                  backgroundColor: theme.tableBackground,
                  borderRadius: 6,
                  padding: 12,
                  marginBottom: 12,
                  border: `1px solid ${theme.tableBorder}`,
                }}
              >
                <Text
                  style={{
                    fontWeight: 600,
                    marginBottom: 12,
                    fontSize: 15,
                    color: theme.pageText,
                  }}
                >
                  Expense {index + 1}
                </Text>

                {/* Amount */}
                <FieldLabel title="Amount" />
                <InputField
                  value={integerToAmount(expense.amount)}
                  onUpdate={value => {
                    const amount = amountToInteger(value);
                    updateExpense(expense.id, 'amount', amount);
                  }}
                />

                {/* Category */}
                <FieldLabel title="Category" />
                <TapField
                  value={
                    category?.name || expense.categoryName || 'Uncategorized'
                  }
                  onClick={() => openCategoryModal(expense.id)}
                />

                {/* Merchant/Payee */}
                <FieldLabel title="Payee" />
                <TapField
                  value={payee?.name || expense.merchant || 'Select payee'}
                  onClick={() => openPayeeModal(expense.id)}
                />

                {/* Account */}
                <FieldLabel title="Account" />
                <TapField
                  value={account?.name || 'Select account'}
                  onClick={() => openAccountModal(expense.id)}
                />

                {/* Date */}
                <FieldLabel title="Date" />
                <InputField
                  value={expense.date}
                  onUpdate={value => updateExpense(expense.id, 'date', value)}
                />

                {/* Notes */}
                <FieldLabel title="Items" />
                <InputField
                  value={expense.note}
                  onUpdate={value => updateExpense(expense.id, 'note', value)}
                  inputMode="text"
                />

                {expense.confidence < 0.8 && (
                  <Text
                    style={{
                      color: theme.warningText,
                      fontSize: 12,
                      marginTop: 5,
                    }}
                  >
                    Low confidence ({Math.round(expense.confidence * 100)}%) -
                    please verify
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Action Buttons - Fixed at bottom */}
        <View
          style={{
            padding: 15,
            paddingBottom: 20,
            backgroundColor: theme.tableBackground,
            borderTop: `1px solid ${theme.tableBorder}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <Button
            onPress={handleSave}
            variant="primary"
            isDisabled={!canSave}
            style={{ width: '100%', padding: '12px' }}
          >
            <SvgCheckmark style={{ width: 16, height: 16, marginRight: 5 }} />
            Save {expenses.length} Transaction{expenses.length !== 1 ? 's' : ''}
          </Button>

          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <Button onPress={handleRetry} style={{ flex: 1, padding: '10px' }}>
              <SvgRefresh style={{ width: 16, height: 16, marginRight: 5 }} />
              Retry
            </Button>
            <Button onPress={handleCancel} style={{ flex: 1, padding: '10px' }}>
              <SvgTrash style={{ width: 16, height: 16, marginRight: 5 }} />
              Cancel
            </Button>
          </View>
        </View>
      </View>
    </Page>
  );
}
