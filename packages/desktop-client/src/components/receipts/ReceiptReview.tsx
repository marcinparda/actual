import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import {
  SvgTrash,
  SvgRefresh,
  SvgCheckmark,
} from '@actual-app/components/icons/v1';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

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

import { Page } from '@desktop-client/components/Page';
import { useAccounts } from '@desktop-client/hooks/useAccounts';
import { useCategories } from '@desktop-client/hooks/useCategories';
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

  const openCategoryModal = (
    expenseId: string,
    currentCategoryId: string | null,
  ) => {
    dispatch(
      pushModal({
        modal: {
          name: 'category-autocomplete',
          options: {
            categoryId: currentCategoryId,
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

  const openAccountModal = (
    expenseId: string,
    currentAccountId: string | undefined,
  ) => {
    dispatch(
      pushModal({
        modal: {
          name: 'account-autocomplete',
          options: {
            accountId: currentAccountId,
            onSelect: (accountId: string) => {
              updateExpense(expenseId, 'account', accountId);
            },
          },
        },
      }),
    );
  };

  const openPayeeModal = (
    expenseId: string,
    currentPayeeId: string | undefined,
  ) => {
    dispatch(
      pushModal({
        modal: {
          name: 'payee-autocomplete',
          options: {
            payeeId: currentPayeeId,
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
      <Page title="Processing Receipt">
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 40,
          }}
        >
          <Text style={{ fontSize: 18, marginBottom: 15, fontWeight: 600 }}>
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
      <Page title="Receipt Error">
        <View style={{ flex: 1, padding: 40, maxWidth: 600, margin: '0 auto' }}>
          <Text
            style={{
              color: theme.errorText,
              marginBottom: 20,
              fontSize: 16,
            }}
          >
            {error}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button onPress={handleRetry}>
              <SvgRefresh style={{ width: 16, height: 16, marginRight: 8 }} />
              Retry
            </Button>
            <Button onPress={handleCancel}>Cancel</Button>
          </View>
        </View>
      </Page>
    );
  }

  const canSave = expenses.length > 0 && expenses.every(e => e.account);

  return (
    <Page title="Review Receipt">
      <View style={{ flex: 1, padding: 30 }}>
        <View style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <View
            style={{
              display: 'grid',
              gridTemplateColumns: '400px 1fr',
              gap: 30,
            }}
          >
            {/* Receipt Image Preview */}
            <View>
              <Text
                style={{
                  fontWeight: 600,
                  fontSize: 18,
                  marginBottom: 15,
                }}
              >
                Receipt Image
              </Text>
              {receiptUrl && (
                <View
                  style={{
                    width: '100%',
                    backgroundColor: theme.tableBackground,
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: `1px solid ${theme.tableBorder}`,
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
              )}
            </View>

            {/* Expenses List */}
            <View>
              <View
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 15,
                }}
              >
                <Text
                  style={{
                    fontWeight: 600,
                    fontSize: 18,
                  }}
                >
                  Detected Expenses ({expenses.length})
                </Text>
              </View>

              <View
                style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
              >
                {expenses.map((expense, index) => {
                  const account = accounts.find(a => a.id === expense.account);
                  const category = categories.find(
                    c => c.id === expense.categoryId,
                  );
                  const payee = payees.find(p => p.id === expense.payee);

                  return (
                    <View
                      key={expense.id}
                      style={{
                        backgroundColor: theme.tableBackground,
                        borderRadius: 8,
                        padding: 20,
                        border: `1px solid ${theme.tableBorder}`,
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: 600,
                          marginBottom: 15,
                          fontSize: 16,
                        }}
                      >
                        Expense {index + 1}
                      </Text>

                      <View
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 15,
                        }}
                      >
                        {/* Amount */}
                        <View>
                          <Text style={{ marginBottom: 5, fontWeight: 500 }}>
                            Amount
                          </Text>
                          <Input
                            value={integerToAmount(expense.amount)}
                            onUpdate={value => {
                              const amount = amountToInteger(value);
                              updateExpense(expense.id, 'amount', amount);
                            }}
                          />
                        </View>

                        {/* Date */}
                        <View>
                          <Text style={{ marginBottom: 5, fontWeight: 500 }}>
                            Date
                          </Text>
                          <Input
                            value={expense.date}
                            onUpdate={value =>
                              updateExpense(expense.id, 'date', value)
                            }
                          />
                        </View>

                        {/* Category */}
                        <View>
                          <Text style={{ marginBottom: 5, fontWeight: 500 }}>
                            Category
                          </Text>
                          <Button
                            onPress={() =>
                              openCategoryModal(expense.id, expense.categoryId)
                            }
                            style={{
                              justifyContent: 'flex-start',
                              width: '100%',
                              padding: '8px 12px',
                            }}
                          >
                            {category?.name ||
                              expense.categoryName ||
                              'Select category'}
                          </Button>
                        </View>

                        {/* Payee */}
                        <View>
                          <Text style={{ marginBottom: 5, fontWeight: 500 }}>
                            Payee
                          </Text>
                          <Button
                            onPress={() =>
                              openPayeeModal(expense.id, expense.payee)
                            }
                            style={{
                              justifyContent: 'flex-start',
                              width: '100%',
                              padding: '8px 12px',
                            }}
                          >
                            {payee?.name || expense.merchant || 'Select payee'}
                          </Button>
                        </View>

                        {/* Account */}
                        <View style={{ gridColumn: '1 / -1' }}>
                          <Text style={{ marginBottom: 5, fontWeight: 500 }}>
                            Account
                          </Text>
                          <Button
                            onPress={() =>
                              openAccountModal(expense.id, expense.account)
                            }
                            style={{
                              justifyContent: 'flex-start',
                              width: '100%',
                              padding: '8px 12px',
                            }}
                          >
                            {account?.name || 'Select account'}
                          </Button>
                        </View>

                        {/* Notes */}
                        <View style={{ gridColumn: '1 / -1' }}>
                          <Text style={{ marginBottom: 5, fontWeight: 500 }}>
                            Items
                          </Text>
                          <Input
                            value={expense.note}
                            onUpdate={value =>
                              updateExpense(expense.id, 'note', value)
                            }
                          />
                        </View>

                        {expense.confidence < 0.8 && (
                          <View style={{ gridColumn: '1 / -1' }}>
                            <Text
                              style={{
                                color: theme.warningText,
                                fontSize: 14,
                              }}
                            >
                              ⚠ Low confidence (
                              {Math.round(expense.confidence * 100)}%) - please
                              verify all fields
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Action Buttons */}
              <View
                style={{
                  marginTop: 30,
                  display: 'flex',
                  flexDirection: 'row',
                  gap: 10,
                  justifyContent: 'flex-end',
                }}
              >
                <Button onPress={handleRetry}>
                  <SvgRefresh
                    style={{ width: 16, height: 16, marginRight: 8 }}
                  />
                  Retry OCR
                </Button>
                <Button onPress={handleCancel}>
                  <SvgTrash style={{ width: 16, height: 16, marginRight: 8 }} />
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onPress={handleSave}
                  isDisabled={!canSave}
                >
                  <SvgCheckmark
                    style={{ width: 16, height: 16, marginRight: 8 }}
                  />
                  Save {expenses.length} Transaction
                  {expenses.length !== 1 ? 's' : ''}
                </Button>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Page>
  );
}
