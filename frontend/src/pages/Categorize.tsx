import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  CornerDownLeft,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency } from '../utils/currency';
import * as assistantLogic from '../features/categorizeAssistant';
import type { Category, Transaction } from '../types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const Categorize: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [userRules, setUserRules] = useState<assistantLogic.AssistantRule[]>([]);
  const [historyRules, setHistoryRules] = useState<assistantLogic.AssistantRule[]>([]);
  const [heuristicRules, setHeuristicRules] = useState<assistantLogic.AssistantRule[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I am your categorization assistant. I can help you group your uncategorized operations. You can teach me rules like: “when you see Starbucks, use food.coffee”.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBaseData = useCallback(async () => {
    setLoading(true);
    try {
      const [categoryData, transactionData] = await Promise.all([
        api.getCategories(),
        api.listTransactions({ category_key: 'null', limit: 500 }),
      ]);
      
      setCategories(categoryData);
      
      // FIX: TransactionListResponse has "items", not "transactions"
      const queueItems = transactionData.items || [];
      setQueue(queueItems);
      
      // Load some initial history-based rules if we have transactions
      if (queueItems.length > 0) {
        const historyData = await api.listTransactions({ limit: 1000 });
        const hRules = assistantLogic.buildHistoryRules(historyData.items || []);
        setHistoryRules(hRules);
      }
      
      setHeuristicRules(assistantLogic.buildHeuristicRules());
    } catch (error) {
      console.error('Failed to fetch categorization data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBaseData();
  }, [fetchBaseData]);

  const proposals = useMemo(() => {
    return assistantLogic.buildAssistantProposals({
      queue,
      categories,
      userRules,
      historyRules,
      heuristicRules,
    });
  }, [queue, categories, userRules, historyRules, heuristicRules]);

  const selectedProposal = useMemo(() => {
    return proposals.find((p) => p.id === selectedProposalId) || (proposals.length > 0 ? proposals[0] : null);
  }, [proposals, selectedProposalId]);

  const pendingTransactions = queue;

  const discoverAiSuggestions = async () => {
    if (queue.length === 0) return;
    setAiLoading(true);
    try {
      const limit = 5;
      for (const tx of queue.slice(0, limit)) {
        const prop = await assistantLogic.getAiProposal({ transaction: tx, categories });
        // Handling AI proposals would require merging them into heuristicRules or similar
        // For now we just trigger the loading state to show activity
        console.log('AI Proposal:', prop);
      }
    } catch (error) {
      console.error('AI analysis failed:', error);
    } finally {
      setTimeout(() => setAiLoading(false), 800);
    }
  };

  const applyProposal = async (proposal: assistantLogic.AssistantProposal) => {
    setBusyProposalId(proposal.id);
    try {
      await Promise.all(
        proposal.transactions.map((t) =>
          api.updateTransaction(t.id, { category_key: proposal.category_key }),
        ),
      );
      setQueue((current) => current.filter((t) => !proposal.transactions.some((pt) => pt.id === t.id)));
      if (selectedProposalId === proposal.id) {
        setSelectedProposalId(null);
      }
    } catch (error) {
      console.error('Failed to apply proposal:', error);
    } finally {
      setBusyProposalId(null);
    }
  };

  const rejectProposal = (proposal: assistantLogic.AssistantProposal) => {
    setHeuristicRules((current) => current.filter((r) => r.pattern !== proposal.matched_pattern));
    setUserRules((current) => current.filter((r) => r.pattern !== proposal.matched_pattern));
  };

  const sendMessage = useCallback(() => {
    if (!draft.trim()) return;

    const userMessage: Message = {
      id: `user:${Date.now()}`,
      role: 'user',
      content: draft,
    };

    const parsedRuleBase = assistantLogic.parseRuleInstruction({
      message: draft,
      categories,
      selectedProposal,
    });
    
    let assistantMessage = '';

    if (parsedRuleBase) {
      const newRule = assistantLogic.createInstructionRule({
        pattern: parsedRuleBase.pattern,
        category_key: parsedRuleBase.category_key,
      });
      setUserRules((current) => [...current, newRule]);
      
      const previewProposals = assistantLogic.buildAssistantProposals({
        queue,
        categories,
        userRules: [newRule],
        historyRules: [],
        heuristicRules: [],
      });
      
      const impactedCount = previewProposals
        .filter((p) => p.matched_pattern === newRule.pattern)
        .reduce((total, p) => total + p.transactions.length, 0);

      assistantMessage =
        impactedCount > 0
          ? `Noted. I will treat "${newRule.pattern}" as ${parsedRuleBase.category_label}. That immediately affects ${impactedCount} uncategorized operation${impactedCount > 1 ? 's' : ''}.`
          : `Noted. I will treat "${newRule.pattern}" as ${parsedRuleBase.category_label}. I don't see matching operations right now.`;
    } else if (selectedProposal) {
      assistantMessage = `Current focus: ${selectedProposal.transactions.length} operations. Tell me a pattern and category to group them.`;
    } else {
      assistantMessage = 'I didn\'t quite catch that. Try: "when you see amazon, use shopping".';
    }

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: `assistant:${Date.now()}`,
        role: 'assistant',
        content: assistantMessage,
      },
    ]);
    setDraft('');
  }, [categories, draft, queue, selectedProposal]);

  const formatAmount = formatCurrency;

  return (
    <div className="assistant-shell">
      <div className="assistant-hero">
        <div>
          <span className="assistant-eyebrow">Categorization Assistant</span>
          <h1>Teach once, review fast, apply safely.</h1>
          <p>
            This workspace reviews uncategorized operations, learns from your instructions, and keeps
            every final decision explicit with accept or reject buttons before anything lands in the
            database.
          </p>
        </div>
        <div className="assistant-stats">
          <div>
            <span>Pending</span>
            <strong>{pendingTransactions.length}</strong>
          </div>
          <div>
            <span>Suggestions</span>
            <strong>{proposals.length}</strong>
          </div>
          <div>
            <span>Saved rules</span>
            <strong>{userRules.length}</strong>
          </div>
        </div>
      </div>

      <div className="assistant-workspace">
        <section className="assistant-chat-panel">
          <header className="assistant-panel-header">
            <div className="assistant-panel-title">
              <Sparkles size={18} />
              <div>
                <strong>Conversation</strong>
                <span>Teach the assistant your custom rules.</span>
              </div>
            </div>
            <button className="assistant-refresh" type="button" onClick={() => void fetchBaseData()}>
              Refresh queue
            </button>
          </header>

          <div className="assistant-prompt-row">
            <button
              className="assistant-prompt-chip"
              type="button"
              onClick={() => setDraft('when you see "amazon", use shopping.general')}
            >
              “When I see Amazon…”
            </button>
            <button
              className="assistant-prompt-chip"
              type="button"
              onClick={() => setDraft('categorize all "uber" as transport.taxi')}
            >
              “Categorize Uber as…”
            </button>
            <button
              className="assistant-prompt-chip"
              type="button"
              onClick={() => setDraft('if the description contains "rent", use home.rent')}
            >
              “If contains Rent…”
            </button>
          </div>

          <div className="assistant-messages">
            {messages.map((message) => (
              <div key={message.id} className={`assistant-message ${message.role}`}>
                <div className="assistant-message-badge">
                  {message.role === 'assistant' ? 'Assistant' : 'You'}
                </div>
                <p>{message.content}</p>
              </div>
            ))}
          </div>

          <div className="assistant-composer">
            <div className="assistant-composer-input">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder='Example: when you see "ubereats", use food.restaurant'
                rows={2}
              />
              <button
                type="button"
                className="assistant-send"
                onClick={sendMessage}
                disabled={!draft.trim()}
              >
                <CornerDownLeft size={24} />
              </button>
            </div>
          </div>
        </section>

        <aside className="assistant-rail">
          <div className="assistant-panel-header sticky">
            <div className="assistant-panel-title">
              <Tags size={18} />
              <div>
                <strong>Pending decisions</strong>
                <span>Review what the assistant wants to classify next.</span>
              </div>
            </div>
            <button
              className="assistant-ai-trigger"
              type="button"
              onClick={discoverAiSuggestions}
              disabled={aiLoading || !queue.length}
            >
              <Sparkles size={16} />
              {aiLoading ? 'Thinking…' : 'Ask AI'}
            </button>
          </div>

          {loading ? (
            <div className="assistant-empty">Loading uncategorized operations…</div>
          ) : proposals.length === 0 ? (
            <div className="assistant-empty">
              {pendingTransactions.length === 0
                ? 'No uncategorized operations are waiting right now.'
                : 'No confident proposals yet. Teach a merchant pattern in the chat to unlock suggestions.'}
            </div>
          ) : (
            <div className="assistant-proposal-list">
              {proposals.map((proposal) => {
                const isSelected = selectedProposal?.id === proposal.id;
                const isBusy = busyProposalId === proposal.id;

                return (
                  <article
                    key={proposal.id}
                    className={`assistant-proposal-card ${isSelected ? 'selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="assistant-proposal-focus"
                      onClick={() => setSelectedProposalId(proposal.id)}
                    >
                      <div className="assistant-proposal-copy">
                        <div className="assistant-proposal-topline">
                          <span className={`assistant-confidence ${proposal.source}`}>
                            {proposal.confidence_label}
                          </span>
                          <span className="assistant-proposal-count">
                            {proposal.transactions.length} op{proposal.transactions.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <strong>{proposal.category_label}</strong>
                        <p>{proposal.reason}</p>
                        <div className="assistant-pattern">
                          Pattern: <code>{proposal.matched_pattern}</code>
                        </div>
                      </div>
                      <ChevronRight size={16} />
                    </button>

                    <div className="assistant-transaction-stack">
                      {proposal.transactions.slice(0, 4).map((transaction) => (
                        <div className="assistant-transaction-row" key={transaction.id}>
                          <div>
                            <strong>{transaction.description}</strong>
                            <span>
                              {transaction.transaction_date} · {transaction.source_name}
                            </span>
                          </div>
                          <span>{formatAmount(transaction.amount_minor, transaction.currency)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="assistant-actions">
                      <button
                        type="button"
                        className="assistant-accept"
                        disabled={isBusy}
                        onClick={() => void applyProposal(proposal)}
                      >
                        <Check size={16} />
                        Accept
                      </button>
                      <button
                        type="button"
                        className="assistant-reject"
                        disabled={isBusy}
                        onClick={() => void rejectProposal(proposal)}
                      >
                        <X size={16} />
                        Reject
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      <style>{`
        .assistant-shell {
          display: flex;
          flex-direction: column;
          gap: 2rem;
          padding-bottom: 2rem;
        }
        .assistant-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(340px, 0.6fr);
          gap: 3rem;
          padding: 2.5rem;
          border-radius: 1.5rem;
          border: 1px solid var(--border-color);
          background:
            var(--surface-reflection),
            radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--primary-color) 12%, transparent), transparent 45%),
            var(--surface-color);
          box-shadow: var(--shadow-medium);
          margin-bottom: 1rem;
        }
        .assistant-eyebrow {
          display: inline-flex;
          padding: 0.4rem 0.85rem;
          border-radius: 2rem;
          background: var(--surface-accent);
          border: 1px solid var(--border-subtle);
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--primary-color);
          margin-bottom: 0.5rem;
        }
        .assistant-hero h1 {
          margin: 1rem 0 0.85rem;
          font-size: clamp(2rem, 4vw, 2.75rem);
          line-height: 1.1;
          letter-spacing: -0.02em;
        }
        .assistant-hero p {
          margin: 0;
          max-width: 50ch;
          color: var(--text-muted);
          line-height: 1.6;
          font-size: 1.05rem;
        }
        .assistant-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
          align-self: center;
        }
        .assistant-stats div {
          padding: 1.75rem 1rem;
          border-radius: 1.25rem;
          background: var(--surface-muted);
          border: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .assistant-stats div:hover {
          transform: translateY(-4px);
          background: var(--surface-hover);
          box-shadow: var(--shadow-soft);
          border-color: var(--primary-color);
        }
        .assistant-stats span {
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 700;
        }
        .assistant-stats strong {
          font-size: 2rem;
          color: var(--text-main);
          font-weight: 800;
          line-height: 1;
        }
        .assistant-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(380px, 0.9fr);
          gap: 2rem;
          align-items: start;
        }
        .assistant-chat-panel,
        .assistant-rail {
          border-radius: 1.5rem;
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          box-shadow: var(--shadow-soft);
          overflow: hidden;
        }
        .assistant-chat-panel {
          display: flex;
          flex-direction: column;
          min-height: 75vh;
        }
        .assistant-rail {
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 1.5rem;
          max-height: calc(100vh - 3rem);
        }
        .assistant-panel-header {
          padding: 1.75rem;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          gap: 1.5rem;
          align-items: center;
          background: var(--surface-muted);
        }
        .assistant-panel-title {
          display: flex;
          gap: 1rem;
          align-items: center;
          min-width: 0;
        }
        .assistant-panel-title strong {
          display: block;
          font-size: 1.15rem;
          font-weight: 700;
        }
        .assistant-panel-title span {
          display: block;
          margin-top: 0.15rem;
          color: var(--text-muted);
          font-size: 0.875rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .assistant-refresh {
          flex: 0 0 auto;
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          color: var(--text-main);
          border-radius: 2rem;
          padding: 0.55rem 1rem;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        .assistant-refresh:hover {
          background: var(--surface-hover);
          border-color: var(--text-muted);
        }
        .assistant-prompt-row {
          display: flex;
          gap: 0.75rem;
          overflow-x: auto;
          padding: 1.25rem 1.75rem;
          scrollbar-width: none;
          background: var(--surface-color);
        }
        .assistant-prompt-row::-webkit-scrollbar {
          display: none;
        }
        .assistant-prompt-chip {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
          color: var(--text-main);
          border-radius: 2rem;
          padding: 0.75rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .assistant-prompt-chip:hover {
          background: var(--surface-accent);
          border-color: var(--primary-color);
          color: var(--primary-color);
        }
        .assistant-messages {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          overflow-y: auto;
          padding: 1.75rem;
        }
        .assistant-message {
          max-width: 85%;
          border-radius: 1.5rem;
          padding: 1.25rem 1.5rem;
          border: 1px solid var(--border-color);
          position: relative;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
        }
        .assistant-message.assistant {
          background: var(--surface-muted);
          border-bottom-left-radius: 0.4rem;
        }
        .assistant-message.user {
          margin-left: auto;
          background: var(--primary-color);
          color: var(--primary-contrast);
          border-color: transparent;
          border-bottom-right-radius: 0.4rem;
        }
        .assistant-message p {
          margin: 0;
          line-height: 1.6;
          font-size: 1rem;
        }
        .assistant-message-badge {
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 0.75rem;
          opacity: 0.6;
          font-weight: 800;
        }
        .assistant-composer {
          padding: 1.75rem;
          background: var(--surface-muted);
          border-top: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .assistant-composer-input {
          position: relative;
          display: flex;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 1.25rem;
          padding: 0.5rem;
          transition: all 0.25s;
          box-shadow: var(--shadow-soft);
        }
        .assistant-composer-input:focus-within {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary-color) 12%, transparent);
        }
        .assistant-composer textarea {
          flex: 1;
          resize: none;
          min-height: 60px;
          border: none;
          background: transparent;
          color: var(--text-main);
          padding: 0.75rem 1rem;
          font: inherit;
          font-size: 1rem;
          line-height: 1.5;
        }
        .assistant-composer textarea:focus {
          outline: none;
        }
        .assistant-send {
          align-self: flex-end;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 3.5rem;
          height: 3.5rem;
          border: none;
          border-radius: 1rem;
          background: var(--primary-color);
          color: var(--primary-contrast);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .assistant-send:hover:not(:disabled) {
          transform: scale(1.05);
          filter: brightness(1.1);
          box-shadow: 0 8px 20px color-mix(in srgb, var(--primary-color) 30%, transparent);
        }
        .assistant-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          filter: grayscale(1);
        }
        .assistant-empty {
          padding: 4rem 2rem;
          color: var(--text-muted);
          text-align: center;
          font-size: 1rem;
          background: var(--surface-color);
        }
        .assistant-proposal-list {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          padding: 1.25rem;
          gap: 1.25rem;
        }
        .assistant-proposal-card {
          border: 1px solid var(--border-color);
          border-radius: 1.5rem;
          background: var(--surface-color);
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .assistant-proposal-card.selected {
          border-color: var(--primary-color);
          box-shadow: var(--shadow-medium);
          background: var(--surface-muted);
        }
        .assistant-proposal-focus {
          width: 100%;
          display: flex;
          justify-content: space-between;
          gap: 1.5rem;
          padding: 1.75rem;
          border: none;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .assistant-proposal-copy strong {
          display: block;
          font-size: 1.25rem;
          margin-bottom: 0.5rem;
          font-weight: 800;
          letter-spacing: -0.01em;
        }
        .assistant-proposal-copy p {
          margin: 0 0 1rem;
          color: var(--text-muted);
          line-height: 1.6;
          font-size: 0.95rem;
        }
        .assistant-proposal-topline {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1rem;
          align-items: center;
        }
        .assistant-confidence {
          display: inline-flex;
          padding: 0.35rem 0.75rem;
          border-radius: 2rem;
          font-size: 0.7rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .assistant-confidence.instruction {
          background: rgba(30, 64, 175, 0.1);
          color: #2563eb;
        }
        .assistant-confidence.history {
          background: rgba(22, 163, 74, 0.12);
          color: #16a34a;
        }
        .assistant-confidence.heuristic {
          background: rgba(217, 119, 6, 0.14);
          color: #d97706;
        }
        .assistant-confidence.ai {
          background: color-mix(in srgb, var(--primary-color) 15%, transparent);
          color: var(--primary-color);
        }
        .assistant-ai-trigger {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 1.25rem;
          border-radius: 2rem;
          border: 1px solid var(--primary-color);
          background: var(--surface-color);
          color: var(--primary-color);
          font-size: 0.875rem;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.25s;
          white-space: nowrap;
        }
        .assistant-ai-trigger:hover:not(:disabled) {
          background: var(--primary-color);
          color: var(--primary-contrast);
          transform: translateY(-2px);
          box-shadow: 0 6px 16px color-mix(in srgb, var(--primary-color) 25%, transparent);
        }
        .assistant-ai-trigger:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          filter: grayscale(1);
        }
        .assistant-proposal-count {
          color: var(--text-muted);
          font-size: 0.85rem;
          font-weight: 600;
        }
        .assistant-pattern {
          font-size: 0.875rem;
          color: var(--text-muted);
        }
        .assistant-pattern code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          color: var(--text-main);
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          padding: 0.15rem 0.45rem;
          font-size: 0.85rem;
        }
        .assistant-transaction-stack {
          display: flex;
          flex-direction: column;
          background: var(--surface-muted);
          border-top: 1px solid var(--border-color);
          border-bottom: 1px solid var(--border-color);
        }
        .assistant-transaction-row {
          display: flex;
          justify-content: space-between;
          gap: 1.25rem;
          padding: 1rem 1.5rem;
          align-items: center;
        }
        .assistant-transaction-row + .assistant-transaction-row {
          border-top: 1px solid var(--border-color);
        }
        .assistant-transaction-row strong {
          font-size: 0.95rem;
          font-weight: 700;
        }
        .assistant-transaction-row span {
          font-size: 0.82rem;
          color: var(--text-muted);
        }
        .assistant-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          padding: 1.5rem;
          background: var(--surface-color);
        }
        .assistant-accept,
        .assistant-reject {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          border-radius: 1rem;
          padding: 1rem;
          font-weight: 800;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .assistant-accept {
          border: none;
          background: var(--primary-color);
          color: var(--primary-contrast);
        }
        .assistant-reject {
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          color: var(--text-main);
        }
        .assistant-accept:hover, .assistant-reject:hover {
          transform: translateY(-2px);
          filter: brightness(1.05);
        }
        @media (max-width: 1200px) {
          .assistant-hero {
            grid-template-columns: 1fr;
            padding: 2rem;
          }
          .assistant-workspace {
            grid-template-columns: 1fr;
          }
          .assistant-rail {
            position: static;
            max-height: none;
          }
        }
        @media (max-width: 720px) {
          .assistant-stats {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
          .assistant-actions {
            grid-template-columns: 1fr;
          }
          .assistant-hero {
            padding: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
};

export default Categorize;
