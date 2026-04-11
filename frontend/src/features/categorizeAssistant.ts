import type { Category, Transaction } from '../types';
import { api } from '../services/api';

export interface AssistantRule {
  id: string;
  pattern: string;
  category_key: string;
  created_at: string;
  source: 'instruction' | 'history' | 'heuristic' | 'ai';
  confidence: number;
  note?: string;
}

export interface AssistantProposal {
  id: string;
  category_key: string;
  category_label: string;
  source: AssistantRule['source'];
  confidence: number;
  confidence_label: string;
  reason: string;
  matched_pattern: string;
  transactions: Transaction[];
}

const STOP_WORDS = new Set([
  'achat',
  'cb',
  'carte',
  'cartebancaire',
  'card',
  'payment',
  'paiement',
  'prelevement',
  'prelev',
  'vir',
  'virement',
  'inst',
  'sepa',
  'fr',
  'eu',
  'debit',
  'credit',
  'operation',
  'transaction',
  'fact',
  'facture',
  'prlv',
  'pos',
  'shop',
]);

const HEURISTIC_RULES: Array<{ pattern: string; category_key: string; note: string; confidence: number }> = [
  { pattern: 'carrefour', category_key: 'food.grocery', note: 'Merchant often maps to groceries.', confidence: 0.7 },
  { pattern: 'monoprix', category_key: 'food.grocery', note: 'Merchant often maps to groceries.', confidence: 0.7 },
  { pattern: 'uber eats', category_key: 'food.restaurant', note: 'Food delivery usually belongs to restaurants.', confidence: 0.74 },
  { pattern: 'deliveroo', category_key: 'food.restaurant', note: 'Food delivery usually belongs to restaurants.', confidence: 0.74 },
  { pattern: 'netflix', category_key: 'leisure.subscription', note: 'Recurring media service.', confidence: 0.8 },
  { pattern: 'spotify', category_key: 'leisure.subscription', note: 'Recurring media service.', confidence: 0.8 },
  { pattern: 'sncf', category_key: 'transport.public', note: 'Public transport operator.', confidence: 0.76 },
  { pattern: 'navigo', category_key: 'transport.public', note: 'Public transport pass.', confidence: 0.76 },
  { pattern: 'edf', category_key: 'housing.utilities', note: 'Utility provider.', confidence: 0.78 },
  { pattern: 'free mobile', category_key: 'housing.utilities', note: 'Telecom bill.', confidence: 0.72 },
  { pattern: 'amazon', category_key: 'shopping.general', note: 'General shopping merchant.', confidence: 0.66 },
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelForCategory(categories: Category[], key: string) {
  return categories.find((category) => category.key === key)?.label ?? key;
}

function confidenceLabel(confidence: number) {
  if (confidence >= 0.82) {
    return 'High confidence';
  }
  if (confidence >= 0.66) {
    return 'Medium confidence';
  }
  return 'Low confidence';
}

export function isAssistantRejected(transaction: Transaction) {
  return transaction.metadata.assistant_review_status === 'rejected';
}

export function merchantFingerprint(transaction: Transaction) {
  const raw = normalizeText(
    [
      transaction.description,
      typeof transaction.external_reference === 'string' ? transaction.external_reference : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  const tokens = raw
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return tokens.slice(0, 3).join(' ');
}

export function buildHistoryRules(history: Transaction[]): AssistantRule[] {
  const bucket = new Map<
    string,
    {
      total: number;
      byCategory: Map<string, number>;
    }
  >();

  for (const transaction of history) {
    if (!transaction.category_key) {
      continue;
    }

    const fingerprint = merchantFingerprint(transaction);
    if (!fingerprint) {
      continue;
    }

    const entry = bucket.get(fingerprint) ?? { total: 0, byCategory: new Map<string, number>() };
    entry.total += 1;
    entry.byCategory.set(
      transaction.category_key,
      (entry.byCategory.get(transaction.category_key) ?? 0) + 1,
    );
    bucket.set(fingerprint, entry);
  }

  const rules: AssistantRule[] = [];

  for (const [pattern, entry] of bucket) {
    if (entry.total < 2) {
      continue;
    }

    const winning = [...entry.byCategory.entries()].sort((left, right) => right[1] - left[1])[0];
    if (!winning) {
      continue;
    }

    const [category_key, matches] = winning;
    const confidence = matches / entry.total;
    if (confidence < 0.6) {
      continue;
    }

    rules.push({
      id: `history:${pattern}:${category_key}`,
      pattern,
      category_key,
      created_at: '',
      source: 'history',
      confidence,
      note: `${matches} similar categorized transaction${matches > 1 ? 's' : ''} matched this merchant pattern.`,
    });
  }

  return rules;
}

export function buildHeuristicRules(): AssistantRule[] {
  return HEURISTIC_RULES.map((rule) => ({
    id: `heuristic:${rule.pattern}:${rule.category_key}`,
    pattern: rule.pattern,
    category_key: rule.category_key,
    created_at: '',
    source: 'heuristic',
    confidence: rule.confidence,
    note: rule.note,
  }));
}

function scoreRule(rule: AssistantRule, normalizedDescription: string) {
  if (!normalizedDescription.includes(rule.pattern)) {
    return -1;
  }

  return rule.confidence + (rule.pattern.length / 1000);
}

export function buildAssistantProposals(params: {
  queue: Transaction[];
  categories: Category[];
  userRules: AssistantRule[];
  historyRules: AssistantRule[];
  heuristicRules: AssistantRule[];
}) {
  const { queue, categories, userRules, historyRules, heuristicRules } = params;
  const allRules = [...userRules, ...historyRules, ...heuristicRules];
  const groups = new Map<string, AssistantProposal>();

  for (const transaction of queue) {
    if (transaction.category_key || isAssistantRejected(transaction)) {
      continue;
    }

    const normalizedDescription = normalizeText(
      [transaction.description, transaction.external_reference ?? ''].join(' '),
    );
    const bestRule = allRules
      .map((rule) => ({ rule, score: scoreRule(rule, normalizedDescription) }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        const sourceWeight = { instruction: 3, history: 2, heuristic: 1, ai: 0 };
        return sourceWeight[right.rule.source] - sourceWeight[left.rule.source];
      })[0]?.rule;

    if (!bestRule) {
      continue;
    }

    const id = `${bestRule.source}:${bestRule.category_key}:${bestRule.pattern}`;
    const existing = groups.get(id);

    if (existing) {
      existing.transactions.push(transaction);
      continue;
    }

    groups.set(id, {
      id,
      category_key: bestRule.category_key,
      category_label: labelForCategory(categories, bestRule.category_key),
      source: bestRule.source,
      confidence: bestRule.confidence,
      confidence_label: confidenceLabel(bestRule.confidence),
      reason: bestRule.note ?? 'Assistant matched a known pattern.',
      matched_pattern: bestRule.pattern,
      transactions: [transaction],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return right.transactions.length - left.transactions.length;
  });
}

function normalizeCategoryReference(category: Category) {
  return [normalizeText(category.key), normalizeText(category.label)];
}

export function resolveCategoryFromMessage(message: string, categories: Category[]) {
  const normalized = normalizeText(message);

  return categories.find((category) =>
    normalizeCategoryReference(category).some((candidate) => normalized.includes(candidate)),
  );
}

export function parseRuleInstruction(params: {
  message: string;
  categories: Category[];
  selectedProposal?: AssistantProposal | null;
}) {
  const { message, categories, selectedProposal } = params;
  const category = resolveCategoryFromMessage(message, categories);
  if (!category) {
    return null;
  }

  const directQuotedMatch = message.match(/["'“”]([^"'“”]+)["'“”]/);
  const containsMatch = message.match(
    /(?:contient|contains|quand tu vois|when you see)\s+["'“”]?([^,"'“”.]+(?:\s+[^,"'“”.]+)*)/i,
  );
  const pattern =
    normalizeText(directQuotedMatch?.[1] ?? containsMatch?.[1] ?? selectedProposal?.matched_pattern ?? '');

  if (!pattern) {
    return null;
  }

  return {
    pattern,
    category_key: category.key,
    category_label: category.label,
  };
}

export function createInstructionRule(params: {
  pattern: string;
  category_key: string;
  note?: string;
}): AssistantRule {
  return {
    id: `instruction:${params.pattern}:${params.category_key}:${Date.now()}`,
    pattern: params.pattern,
    category_key: params.category_key,
    created_at: new Date().toISOString(),
    source: 'instruction',
    confidence: 0.96,
    note: params.note ?? 'You explicitly taught this rule to the assistant.',
  };
}

export async function getAiProposal(params: {
  transaction: Transaction;
  categories: Category[];
}): Promise<AssistantProposal | null> {
  try {
    const { transaction, categories } = params;
    const suggestion = await api.suggestCategory({
      description: transaction.description,
      existing_category: transaction.category_key ?? undefined,
    });

    return {
      id: `ai:${suggestion.category_key}:${transaction.id}`,
      category_key: suggestion.category_key,
      category_label: labelForCategory(categories, suggestion.category_key),
      source: 'ai',
      confidence: suggestion.confidence,
      confidence_label: confidenceLabel(suggestion.confidence),
      reason: suggestion.reasoning,
      matched_pattern: transaction.description,
      transactions: [transaction],
    };
  } catch (error) {
    console.error('Failed to get AI proposal:', error);
    return null;
  }
}
