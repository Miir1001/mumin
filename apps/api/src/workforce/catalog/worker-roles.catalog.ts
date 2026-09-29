import { AiDepartment, RiskLevel } from "@talenthub/database";
import type { ApprovalPolicy } from "../policy/approval-policy";

export interface TaskTypeDefinition {
  key: string;
  label: string;
  description: string;
  /** Tasks of this type always go to a human before their action is executed, regardless of policy. */
  alwaysRequiresApproval: boolean;
}

export interface WorkerRoleDefinition {
  key: string;
  name: string;
  department: AiDepartment;
  description: string;
  capabilities: string[];
  taskTypes: TaskTypeDefinition[];
  defaultPolicy: ApprovalPolicy;
  /** Subscription price per AI worker per month. */
  monthlyPriceUsd: number;
  /** Fully loaded hourly cost of the human role this worker offloads; drives savings metrics. */
  humanHourlyCostUsd: number;
  /** Average human time one task of this role would take. */
  minutesSavedPerTask: number;
  /** Role-specific guidance appended to the shared worker system prompt. */
  prompt: string;
}

/**
 * The catalog of AI workers an organization can hire. Kept in code rather than the database so that
 * prompts, task types, and default guardrails are versioned and reviewed like any other logic.
 */
export const WORKER_ROLES: readonly WorkerRoleDefinition[] = [
  {
    key: "hr-assistant",
    name: "HR Assistant",
    department: AiDepartment.HR,
    description: "Screens candidates, answers employee policy questions, and prepares HR paperwork.",
    capabilities: ["Candidate screening", "Policy Q&A", "Onboarding checklists", "Offer letter drafts"],
    taskTypes: [
      {
        key: "screen-candidate",
        label: "Screen candidate",
        description: "Assess a candidate's resume against a job's requirements and recommend next steps.",
        alwaysRequiresApproval: false,
      },
      {
        key: "answer-policy-question",
        label: "Answer policy question",
        description: "Answer an employee's HR question using the supplied policy text.",
        alwaysRequiresApproval: false,
      },
      {
        key: "prepare-onboarding",
        label: "Prepare onboarding",
        description: "Produce an onboarding checklist and welcome message for a new hire.",
        alwaysRequiresApproval: false,
      },
      {
        key: "draft-offer-letter",
        label: "Draft offer letter",
        description: "Draft an employment offer letter from the approved compensation details.",
        alwaysRequiresApproval: true,
      },
    ],
    defaultPolicy: {
      autoApproveMaxAmount: 0,
      minConfidence: 0.8,
      approvalRiskThreshold: RiskLevel.HIGH,
      requireApprovalForTaskTypes: [],
    },
    monthlyPriceUsd: 499,
    humanHourlyCostUsd: 38,
    minutesSavedPerTask: 25,
    prompt:
      "You act as an HR generalist. Be fair and consistent: never consider or infer protected characteristics " +
      "(age, gender, ethnicity, religion, disability, and similar). Base screening only on job-relevant evidence.",
  },
  {
    key: "procurement-officer",
    name: "Procurement Officer",
    department: AiDepartment.PROCUREMENT,
    description: "Compares supplier quotes, drafts purchase orders, and checks vendor risk.",
    capabilities: ["Quote comparison", "Purchase order drafting", "Vendor risk checks"],
    taskTypes: [
      {
        key: "compare-quotes",
        label: "Compare quotes",
        description: "Compare supplier quotes on price, delivery, and terms and recommend one.",
        alwaysRequiresApproval: false,
      },
      {
        key: "draft-purchase-order",
        label: "Draft purchase order",
        description: "Draft a purchase order from an approved requisition.",
        alwaysRequiresApproval: false,
      },
      {
        key: "vendor-risk-check",
        label: "Vendor risk check",
        description: "Review supplied vendor information for compliance, financial, and delivery risk.",
        alwaysRequiresApproval: false,
      },
    ],
    defaultPolicy: {
      autoApproveMaxAmount: 5_000,
      minConfidence: 0.8,
      approvalRiskThreshold: RiskLevel.HIGH,
      requireApprovalForTaskTypes: [],
    },
    monthlyPriceUsd: 599,
    humanHourlyCostUsd: 42,
    minutesSavedPerTask: 40,
    prompt:
      "You act as a procurement officer. Favor total cost of ownership over sticker price and call out missing " +
      "terms (payment, delivery, warranty) explicitly.",
  },
  {
    key: "finance-clerk",
    name: "Finance Clerk",
    department: AiDepartment.FINANCE,
    description: "Processes invoices, reviews expenses, and reconciles transactions.",
    capabilities: ["Invoice processing", "Expense review", "Transaction reconciliation"],
    taskTypes: [
      {
        key: "process-invoice",
        label: "Process invoice",
        description: "Validate an invoice against its purchase order and prepare it for payment.",
        alwaysRequiresApproval: false,
      },
      {
        key: "review-expense",
        label: "Review expense claim",
        description: "Check an expense claim against the expense policy.",
        alwaysRequiresApproval: false,
      },
      {
        key: "reconcile-transactions",
        label: "Reconcile transactions",
        description: "Match bank transactions to ledger entries and flag discrepancies.",
        alwaysRequiresApproval: false,
      },
    ],
    defaultPolicy: {
      autoApproveMaxAmount: 1_000,
      minConfidence: 0.9,
      approvalRiskThreshold: RiskLevel.MEDIUM,
      requireApprovalForTaskTypes: [],
    },
    monthlyPriceUsd: 699,
    humanHourlyCostUsd: 45,
    minutesSavedPerTask: 20,
    prompt:
      "You act as a finance clerk. Double-check arithmetic, totals, tax, and currency. Treat any mismatch between " +
      "documents as a discrepancy to report, never something to silently correct.",
  },
  {
    key: "customer-service-agent",
    name: "Customer Service Agent",
    department: AiDepartment.CUSTOMER_SERVICE,
    description: "Triages and answers customer tickets and handles refund requests.",
    capabilities: ["Ticket triage", "Customer replies", "Refund handling"],
    taskTypes: [
      {
        key: "triage-ticket",
        label: "Triage ticket",
        description: "Categorize a ticket, set urgency, and route it.",
        alwaysRequiresApproval: false,
      },
      {
        key: "respond-to-ticket",
        label: "Respond to ticket",
        description: "Draft a reply to a customer using the supplied knowledge base.",
        alwaysRequiresApproval: false,
      },
      {
        key: "process-refund",
        label: "Process refund",
        description: "Decide whether a refund request meets the refund policy and prepare it.",
        alwaysRequiresApproval: false,
      },
    ],
    defaultPolicy: {
      autoApproveMaxAmount: 100,
      minConfidence: 0.75,
      approvalRiskThreshold: RiskLevel.HIGH,
      requireApprovalForTaskTypes: [],
    },
    monthlyPriceUsd: 399,
    humanHourlyCostUsd: 28,
    minutesSavedPerTask: 12,
    prompt:
      "You act as a customer service agent. Be concise, warm, and accurate; only promise what the supplied policy " +
      "allows, and escalate angry or legally sensitive customers.",
  },
  {
    key: "document-processor",
    name: "Document Processor",
    department: AiDepartment.DOCUMENT_PROCESSING,
    description: "Classifies documents, extracts structured fields, and writes summaries.",
    capabilities: ["Classification", "Field extraction", "Summarization"],
    taskTypes: [
      {
        key: "classify-document",
        label: "Classify document",
        description: "Identify the document type and route it.",
        alwaysRequiresApproval: false,
      },
      {
        key: "extract-fields",
        label: "Extract fields",
        description: "Extract the requested fields from a document.",
        alwaysRequiresApproval: false,
      },
      {
        key: "summarize-document",
        label: "Summarize document",
        description: "Summarize a document and list its key obligations, dates, and amounts.",
        alwaysRequiresApproval: false,
      },
    ],
    defaultPolicy: {
      autoApproveMaxAmount: null,
      minConfidence: 0.85,
      approvalRiskThreshold: RiskLevel.HIGH,
      requireApprovalForTaskTypes: [],
    },
    monthlyPriceUsd: 299,
    humanHourlyCostUsd: 30,
    minutesSavedPerTask: 15,
    prompt:
      "You act as a document processing specialist. Extract values exactly as written; if a field is absent or " +
      "illegible, say so rather than guessing.",
  },
  {
    key: "project-coordinator",
    name: "Project Coordinator",
    department: AiDepartment.PROJECT_MANAGEMENT,
    description: "Writes status reports, breaks work into plans, and flags delivery risks.",
    capabilities: ["Status reports", "Work breakdown", "Risk assessment"],
    taskTypes: [
      {
        key: "status-report",
        label: "Status report",
        description: "Write a stakeholder status report from task and milestone updates.",
        alwaysRequiresApproval: false,
      },
      {
        key: "plan-work",
        label: "Plan work",
        description: "Break a goal into tasks with owners, estimates, and dependencies.",
        alwaysRequiresApproval: false,
      },
      {
        key: "assess-risks",
        label: "Assess risks",
        description: "Identify schedule, budget, and scope risks with mitigations.",
        alwaysRequiresApproval: false,
      },
    ],
    defaultPolicy: {
      autoApproveMaxAmount: null,
      minConfidence: 0.7,
      approvalRiskThreshold: RiskLevel.HIGH,
      requireApprovalForTaskTypes: [],
    },
    monthlyPriceUsd: 449,
    humanHourlyCostUsd: 40,
    minutesSavedPerTask: 45,
    prompt:
      "You act as a project coordinator. Be specific about dates, owners, and dependencies, and separate facts " +
      "from your assumptions.",
  },
];

const rolesByKey = new Map(WORKER_ROLES.map((role) => [role.key, role]));

export function findWorkerRole(key: string): WorkerRoleDefinition | undefined {
  return rolesByKey.get(key);
}

export function findTaskType(role: WorkerRoleDefinition, taskTypeKey: string): TaskTypeDefinition | undefined {
  return role.taskTypes.find((taskType) => taskType.key === taskTypeKey);
}
