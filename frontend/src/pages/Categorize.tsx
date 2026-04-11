import React from 'react';
import axios from 'axios';
import {
  Bot,
  Check,
  ChevronRight,
  CornerDownLeft,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import type { Category, JsonValue, Transaction } from '../types';
import { formatCurrency } from '../utils/currency';
import {
  buildAssistantProposals,
  buildHeuristicRules,
  buildHistoryRules,
  createInstructionRule,
  isAssistantRejected,
  parseRuleInstruction,
  type AssistantProposal,
  type AssistantRule,
} from '../features/categorizeAssistant';

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

const USER_RULES_STORAGE_KEY = 'mony.assistant.rules.v1';

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (typeof payload === 'string' && payload.trim() !== '') {
      return payload;
    }
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

function readStoredRules() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(USER_RULES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is AssistantRule => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.pattern === 'string' &&
        typeof item.category_key === 'string'
      );
    });
  } catch {
    return [];
  }
}

function writeStoredRules(rules: AssistantRule[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(USER_RULES_STORAGE_KEY, JSON.stringify(rules));
}

function assistantReviewMetadata(status: 'accepted' | 'rejected', proposal: AssistantProposal) {
  return {
    assistant_review_status: status,
    assistant_review_category_key: proposal.category_key,
    assistant_review_pattern: proposal.matched_pattern,
    assistant_review_source: proposal.source,
    assistant_review_at: new Date().toISOString(),
  } satisfies Record<string, JsonValue>;
}

const suggestedPrompts = [
  'Tout ce qui contient "uber eats" doit aller dans food.restaurant.',
  'Quand tu vois "navigo", classe ça en transport.public.',
  'Explique-moi pourquoi tu proposes groceries pour ces opérations.',
];

export default function Categorize() {
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [queue, setQueue] = React.useState<Transaction[]>([]);
  const [history, setHistory] = React.useState<Transaction[]>([]);
  const [userRules, setUserRules] = React.useState<AssistantRule[]>(() => readStoredRules());
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: 'intro',
      role: 'assistant',
      content:
        "I can review uncategorized operations, suggest categories, and learn your rules. Teach me patterns like “when you see Uber Eats, use food.restaurant”, then accept or reject the proposals on the right.",
    },
  ]);
  const [draft, setDraft] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = React.useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = React.useState<string | null>(null);

  React.useEffect(() => {
    writeStoredRules(userRules);
  }, [userRules]);

  const loadWorkspace = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [categoryData, uncategorizedData, historyData] = await Promise.all([
        api.getCategories(),
        api.listTransactions({
          limit: 32,
          offset: 0,
          uncategorized_only: true,
          sort_by: 'date',
          sort_direction: 'desc',
        }),
        api.listTransactions({
          limit: 250,
          offset: 0,
          sort_by: 'date',
          sort_direction: 'desc',
        }),
      ]);

      setCategories(categoryData);
      setQueue(uncategorizedData.items);
      setHistory(historyData.items.filter((transaction) => transaction.category_key !== null));
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load assistant workspace.'));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const historyRules = React.useMemo(() => buildHistoryRules(history), [history]);
  const heuristicRules = React.useMemo(() => buildHeuristicRules(), []);
  const proposals = React.useMemo(
    () =>
      buildAssistantProposals({
        queue,
        categories,
        userRules,
        historyRules,
        heuristicRules,
      }),
    [categories, heuristicRules, historyRules, queue, userRules],
  );

  React.useEffect(() => {
    if (!proposals.length) {
      setSelectedProposalId(null);
      return;
    }

    if (!selectedProposalId || !proposals.some((proposal) => proposal.id === selectedProposalId)) {
      setSelectedProposalId(proposals[0].id);
    }
  }, [proposals, selectedProposalId]);

  const selectedProposal =
    proposals.find((proposal) => proposal.id === selectedProposalId) ?? proposals[0] ?? null;

  const pendingTransactions = queue.filter(
    (transaction) => !transaction.category_key && !isAssistantRejected(transaction),
  );

  const applyProposal = React.useCallback(
    async (proposal: AssistantProposal) => {
      setBusyProposalId(proposal.id);
      setError(null);

      try {
        await Promise.all(
          proposal.transactions.map((transaction) =>
            api.updateTransaction(transaction.id, {
              category_key: proposal.category_key,
              metadata: assistantReviewMetadata('accepted', proposal),
            }),
          ),
        );

        setQueue((current) =>
          current.filter(
            (transaction) => !proposal.transactions.some((candidate) => candidate.id === transaction.id),
          ),
        );
        setMessages((current) => [
          ...current,
          {
            id: `accepted:${proposal.id}:${Date.now()}`,
            role: 'assistant',
            content: `Applied ${proposal.category_label} to ${proposal.transactions.length} operation${proposal.transactions.length > 1 ? 's' : ''}. I will use this decision in the current review session.`,
          },
        ]);
      } catch (applyError) {
        setError(getErrorMessage(applyError, 'Failed to apply assistant proposal.'));
      } finally {
        setBusyProposalId(null);
      }
    },
    [],
  );

  const rejectProposal = React.useCallback(async (proposal: AssistantProposal) => {
    setBusyProposalId(proposal.id);
    setError(null);

    try {
      await Promise.all(
        proposal.transactions.map((transaction) =>
          api.updateTransaction(transaction.id, {
            metadata: assistantReviewMetadata('rejected', proposal),
          }),
        ),
      );

      setQueue((current) =>
        current.map((transaction) =>
          proposal.transactions.some((candidate) => candidate.id === transaction.id)
            ? {
                ...transaction,
                metadata: {
                  ...transaction.metadata,
                  ...assistantReviewMetadata('rejected', proposal),
                },
              }
            : transaction,
        ),
      );
      setMessages((current) => [
        ...current,
        {
          id: `rejected:${proposal.id}:${Date.now()}`,
          role: 'assistant',
          content: `Rejected the ${proposal.category_label} proposal for ${proposal.transactions.length} operation${proposal.transactions.length > 1 ? 's' : ''}. I will keep them out of the current suggestion rail until you teach me something more precise.`,
        },
      ]);
    } catch (rejectError) {
      setError(getErrorMessage(rejectError, 'Failed to reject assistant proposal.'));
    } finally {
      setBusyProposalId(null);
    }
  }, []);

  const sendMessage = React.useCallback(() => {
    const message = draft.trim();
    if (!message) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user:${Date.now()}`,
      role: 'user',
      content: message,
    };

    const parsedRule = parseRuleInstruction({
      message,
      categories,
      selectedProposal,
    });

    let assistantMessage = '';

    if (parsedRule) {
      const rule = createInstructionRule({
        pattern: parsedRule.pattern,
        category_key: parsedRule.category_key,
        note: `You taught the assistant that "${parsedRule.pattern}" belongs to ${parsedRule.category_label}.`,
      });
      const nextRules = [rule, ...userRules];
      setUserRules(nextRules);

      const previewProposals = buildAssistantProposals({
        queue,
        categories,
        userRules: nextRules,
        historyRules,
        heuristicRules,
      });
      const impactedCount = previewProposals
        .filter(
          (proposal) =>
            proposal.source === 'instruction' &&
            proposal.matched_pattern === parsedRule.pattern &&
            proposal.category_key === parsedRule.category_key,
        )
        .reduce((total, proposal) => total + proposal.transactions.length, 0);

      assistantMessage =
        impactedCount > 0
          ? `Noted. I will treat "${parsedRule.pattern}" as ${parsedRule.category_label}. That immediately affects ${impactedCount} uncategorized operation${impactedCount > 1 ? 's' : ''} in the current review rail.`
          : `Noted. I will treat "${parsedRule.pattern}" as ${parsedRule.category_label}. I do not see a matching uncategorized operation right now, but the rule is saved for the session.`;
    } else if (selectedProposal) {
      assistantMessage = `Current focus: ${selectedProposal.transactions.length} operation${selectedProposal.transactions.length > 1 ? 's' : ''} proposed as ${selectedProposal.category_label}. If the grouping is wrong, tell me a pattern and category, for example: “when you see ${selectedProposal.matched_pattern}, use another category”.`;
    } else if (proposals.length === 0 && pendingTransactions.length > 0) {
      assistantMessage =
        'I do not have a confident proposal yet. Teach me a merchant or wording pattern and the category to use, and I will rebuild the queue immediately.';
    } else {
      assistantMessage =
        'I am ready. Teach me a rule using a merchant pattern plus a category, and I will convert that into new proposals.';
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
  }, [
    categories,
    draft,
    heuristicRules,
    historyRules,
    pendingTransactions.length,
    proposals.length,
    queue,
    selectedProposal,
    userRules,
  ]);

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

      {error ? <div className="notice error">{error}</div> : null}

      <div className="assistant-workspace">
        <section className="assistant-chat-panel">
          <div className="assistant-panel-header">
            <div className="assistant-panel-title">
              <Bot size={18} />
              <div>
                <strong>Conversation</strong>
                <span>Use plain language to teach patterns or challenge a proposal.</span>
              </div>
            </div>
            <button className="assistant-refresh" type="button" onClick={() => void loadWorkspace()}>
              Refresh queue
            </button>
          </div>

          <div className="assistant-prompt-row">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="assistant-prompt-chip"
                onClick={() => setDraft(prompt)}
              >
                <Sparkles size={14} />
                <span>{prompt}</span>
              </button>
            ))}
          </div>

          <div className="assistant-messages">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`assistant-message ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                <div className="assistant-message-badge">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <p>{message.content}</p>
              </article>
            ))}
          </div>

          <div className="assistant-composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder='Example: when you see "ubereats", use food.restaurant'
              rows={4}
            />
            <button
              type="button"
              className="assistant-send"
              onClick={sendMessage}
              disabled={!draft.trim()}
            >
              <CornerDownLeft size={16} />
              Send instruction
            </button>
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
          gap: 1.75rem;
        }
        .assistant-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.8fr);
          gap: 1rem;
          padding: 1.5rem;
          border-radius: 1rem;
          border: 1px solid color-mix(in srgb, var(--border-color) 72%, #d97706 28%);
          background:
            radial-gradient(circle at top left, rgba(249, 115, 22, 0.16), transparent 38%),
            linear-gradient(135deg, color-mix(in srgb, var(--surface-color) 82%, #fff 18%), color-mix(in srgb, var(--surface-muted) 90%, #f59e0b 10%));
          box-shadow: 0 18px 55px rgba(15, 23, 42, 0.08);
        }
        .assistant-eyebrow {
          display: inline-flex;
          padding: 0.35rem 0.65rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.64);
          border: 1px solid rgba(217, 119, 6, 0.18);
          font-size: 0.78rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #9a3412;
        }
        .assistant-hero h1 {
          margin: 0.85rem 0 0.55rem;
          font-size: clamp(2rem, 3vw, 3rem);
          line-height: 1;
        }
        .assistant-hero p {
          margin: 0;
          max-width: 62ch;
          color: var(--text-muted);
        }
        .assistant-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.75rem;
          align-self: end;
        }
        .assistant-stats div {
          padding: 1rem;
          border-radius: 0.9rem;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.18);
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .assistant-stats span {
          font-size: 0.8rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .assistant-stats strong {
          font-size: 1.45rem;
          color: var(--text-main);
        }
        .assistant-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(360px, 0.9fr);
          gap: 1rem;
          align-items: start;
        }
        .assistant-chat-panel,
        .assistant-rail {
          border-radius: 1rem;
          border: 1px solid var(--border-color);
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 96%, white 4%), var(--surface-color)),
            var(--surface-color);
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.06);
        }
        .assistant-chat-panel {
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          min-height: 70vh;
        }
        .assistant-rail {
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          position: sticky;
          top: 1rem;
          max-height: calc(100vh - 2rem);
        }
        .assistant-panel-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: center;
        }
        .assistant-panel-header.sticky {
          padding-bottom: 0.15rem;
        }
        .assistant-panel-title {
          display: flex;
          gap: 0.8rem;
          align-items: flex-start;
        }
        .assistant-panel-title strong {
          display: block;
          font-size: 1rem;
        }
        .assistant-panel-title span {
          display: block;
          margin-top: 0.1rem;
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .assistant-refresh {
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
          color: var(--text-main);
          border-radius: 999px;
          padding: 0.65rem 0.95rem;
          font-weight: 600;
        }
        .assistant-prompt-row {
          display: flex;
          gap: 0.65rem;
          overflow-x: auto;
          padding-bottom: 0.25rem;
        }
        .assistant-prompt-chip {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          border: 1px solid color-mix(in srgb, var(--border-color) 70%, #f59e0b 30%);
          background: color-mix(in srgb, var(--surface-muted) 82%, #fff 18%);
          color: var(--text-main);
          border-radius: 999px;
          padding: 0.7rem 0.9rem;
          font-size: 0.88rem;
        }
        .assistant-messages {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          overflow: auto;
          padding-right: 0.2rem;
        }
        .assistant-message {
          max-width: 88%;
          border-radius: 1rem;
          padding: 0.95rem 1rem;
          border: 1px solid var(--border-color);
        }
        .assistant-message.assistant {
          background: color-mix(in srgb, var(--surface-muted) 78%, #fff 22%);
        }
        .assistant-message.user {
          margin-left: auto;
          background: linear-gradient(135deg, #172554, #1d4ed8);
          color: white;
          border-color: rgba(29, 78, 216, 0.2);
        }
        .assistant-message p {
          margin: 0;
          line-height: 1.55;
        }
        .assistant-message-badge {
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 0.55rem;
          opacity: 0.72;
        }
        .assistant-composer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.85rem;
          align-items: end;
          padding-top: 0.35rem;
          border-top: 1px solid var(--border-color);
        }
        .assistant-composer textarea {
          width: 100%;
          resize: vertical;
          min-height: 110px;
          border-radius: 0.95rem;
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
          color: var(--text-main);
          padding: 0.9rem 1rem;
          font: inherit;
        }
        .assistant-send {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          border: none;
          border-radius: 999px;
          padding: 0.85rem 1.1rem;
          background: linear-gradient(135deg, #d97706, #f97316);
          color: white;
          font-weight: 700;
          box-shadow: 0 14px 28px rgba(217, 119, 6, 0.25);
        }
        .assistant-send:disabled {
          opacity: 0.5;
          box-shadow: none;
        }
        .assistant-empty {
          padding: 1.2rem;
          border-radius: 0.95rem;
          background: var(--surface-muted);
          color: var(--text-muted);
          text-align: center;
        }
        .assistant-proposal-list {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          overflow: auto;
          padding-right: 0.15rem;
        }
        .assistant-proposal-card {
          border: 1px solid var(--border-color);
          border-radius: 1rem;
          background:
            radial-gradient(circle at top right, rgba(249, 115, 22, 0.1), transparent 35%),
            var(--surface-color);
          overflow: hidden;
        }
        .assistant-proposal-card.selected {
          border-color: color-mix(in srgb, var(--border-color) 50%, #f97316 50%);
          box-shadow: 0 18px 30px rgba(249, 115, 22, 0.12);
        }
        .assistant-proposal-focus {
          width: 100%;
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem;
          border: none;
          background: transparent;
          color: inherit;
          text-align: left;
        }
        .assistant-proposal-copy strong {
          display: block;
          font-size: 1.05rem;
          margin-bottom: 0.35rem;
        }
        .assistant-proposal-copy p {
          margin: 0 0 0.65rem;
          color: var(--text-muted);
          line-height: 1.45;
        }
        .assistant-proposal-topline {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.65rem;
          align-items: center;
        }
        .assistant-confidence {
          display: inline-flex;
          padding: 0.28rem 0.55rem;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .assistant-confidence.instruction {
          background: rgba(30, 64, 175, 0.1);
          color: #1d4ed8;
        }
        .assistant-confidence.history {
          background: rgba(22, 163, 74, 0.12);
          color: #15803d;
        }
        .assistant-confidence.heuristic {
          background: rgba(217, 119, 6, 0.14);
          color: #b45309;
        }
        .assistant-proposal-count {
          color: var(--text-muted);
          font-size: 0.85rem;
        }
        .assistant-pattern {
          font-size: 0.82rem;
          color: var(--text-muted);
        }
        .assistant-pattern code {
          font-family: inherit;
          color: var(--text-main);
          background: rgba(148, 163, 184, 0.12);
          border-radius: 0.45rem;
          padding: 0.16rem 0.4rem;
        }
        .assistant-transaction-stack {
          display: flex;
          flex-direction: column;
          border-top: 1px solid var(--border-color);
          border-bottom: 1px solid var(--border-color);
        }
        .assistant-transaction-row {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.85rem 1rem;
          align-items: center;
        }
        .assistant-transaction-row + .assistant-transaction-row {
          border-top: 1px solid rgba(148, 163, 184, 0.12);
        }
        .assistant-transaction-row strong,
        .assistant-transaction-row span {
          display: block;
        }
        .assistant-transaction-row strong {
          font-size: 0.92rem;
        }
        .assistant-transaction-row span {
          font-size: 0.82rem;
          color: var(--text-muted);
        }
        .assistant-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
          padding: 1rem;
        }
        .assistant-accept,
        .assistant-reject {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          border-radius: 0.85rem;
          padding: 0.85rem 1rem;
          font-weight: 700;
        }
        .assistant-accept {
          border: none;
          background: linear-gradient(135deg, #065f46, #10b981);
          color: white;
        }
        .assistant-reject {
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
          color: var(--text-main);
        }
        @media (max-width: 1080px) {
          .assistant-hero,
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
          }
          .assistant-composer {
            grid-template-columns: 1fr;
          }
          .assistant-message {
            max-width: 100%;
          }
          .assistant-actions {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
