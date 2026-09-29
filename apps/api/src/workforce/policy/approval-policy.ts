import { RiskLevel } from "@talenthub/database";

export interface ApprovalPolicy {
  /**
   * Largest monetary amount a worker may act on without a human. `null` means amounts never trigger
   * approval on their own (e.g. document summarization); `0` means any non-zero amount does.
   */
  autoApproveMaxAmount: number | null;
  /** Outcomes the worker is less confident about than this (0-1) go to a human. */
  minConfidence: number;
  /** Outcomes assessed at or above this risk level go to a human. */
  approvalRiskThreshold: RiskLevel;
  /** Task types this organization always wants a human to sign off on. */
  requireApprovalForTaskTypes: string[];
}

export interface TaskOutcome {
  taskType: string;
  taskTypeAlwaysRequiresApproval: boolean;
  amount: number | null;
  confidence: number;
  assessedRisk: RiskLevel;
  workerRequestedReview: boolean;
}

export interface ApprovalDecision {
  requiresApproval: boolean;
  riskLevel: RiskLevel;
  reasons: string[];
}

const RISK_ORDER: readonly RiskLevel[] = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];

export function riskRank(level: RiskLevel): number {
  return RISK_ORDER.indexOf(level);
}

export function maxRisk(...levels: RiskLevel[]): RiskLevel {
  return levels.reduce((highest, level) => (riskRank(level) > riskRank(highest) ? level : highest), RiskLevel.LOW);
}

/** Risk implied purely by how far an amount exceeds what the policy allows unattended. */
function amountRisk(amount: number | null, limit: number | null): RiskLevel {
  if (amount === null || limit === null || amount <= limit) {
    return RiskLevel.LOW;
  }
  if (limit > 0 && amount >= limit * 10) {
    return RiskLevel.CRITICAL;
  }
  return RiskLevel.HIGH;
}

/**
 * Decides whether an AI worker's outcome can be executed automatically or must wait for a human.
 * Deliberately conservative: any single rule tripping escalates the task, and the reported risk is
 * the highest risk any rule implies, so reviewers can triage the queue by risk.
 */
export function evaluateApproval(policy: ApprovalPolicy, outcome: TaskOutcome): ApprovalDecision {
  const reasons: string[] = [];

  if (outcome.taskTypeAlwaysRequiresApproval) {
    reasons.push(`"${outcome.taskType}" tasks always require human approval`);
  }
  if (policy.requireApprovalForTaskTypes.includes(outcome.taskType)) {
    reasons.push(`Organization policy requires approval for "${outcome.taskType}" tasks`);
  }
  if (outcome.amount !== null && policy.autoApproveMaxAmount !== null && outcome.amount > policy.autoApproveMaxAmount) {
    reasons.push(`Amount ${outcome.amount} exceeds the auto-approval limit of ${policy.autoApproveMaxAmount}`);
  }
  if (outcome.confidence < policy.minConfidence) {
    reasons.push(
      `Confidence ${outcome.confidence.toFixed(2)} is below the required ${policy.minConfidence.toFixed(2)}`,
    );
  }

  const riskLevel = maxRisk(
    outcome.assessedRisk,
    amountRisk(outcome.amount, policy.autoApproveMaxAmount),
    outcome.taskTypeAlwaysRequiresApproval ? RiskLevel.MEDIUM : RiskLevel.LOW,
  );
  if (riskRank(riskLevel) >= riskRank(policy.approvalRiskThreshold)) {
    reasons.push(`Risk level ${riskLevel} meets the approval threshold of ${policy.approvalRiskThreshold}`);
  }
  if (outcome.workerRequestedReview) {
    reasons.push("The AI worker flagged this outcome for human review");
  }

  return { requiresApproval: reasons.length > 0, riskLevel, reasons };
}

/** Merges stored per-worker overrides onto a role's defaults, ignoring malformed values. */
export function resolvePolicy(defaults: ApprovalPolicy, overrides: unknown): ApprovalPolicy {
  if (typeof overrides !== "object" || overrides === null) {
    return { ...defaults };
  }
  const o = overrides as Record<string, unknown>;
  return {
    autoApproveMaxAmount:
      o.autoApproveMaxAmount === null || typeof o.autoApproveMaxAmount === "number"
        ? o.autoApproveMaxAmount
        : defaults.autoApproveMaxAmount,
    minConfidence: typeof o.minConfidence === "number" ? o.minConfidence : defaults.minConfidence,
    approvalRiskThreshold: RISK_ORDER.includes(o.approvalRiskThreshold as RiskLevel)
      ? (o.approvalRiskThreshold as RiskLevel)
      : defaults.approvalRiskThreshold,
    requireApprovalForTaskTypes: Array.isArray(o.requireApprovalForTaskTypes)
      ? o.requireApprovalForTaskTypes.filter((t): t is string => typeof t === "string")
      : defaults.requireApprovalForTaskTypes,
  };
}
