import { RiskLevel } from "@talenthub/database";
import { ApprovalPolicy, TaskOutcome, evaluateApproval, maxRisk, resolvePolicy } from "./approval-policy";

describe("evaluateApproval", () => {
  const policy: ApprovalPolicy = {
    autoApproveMaxAmount: 1_000,
    minConfidence: 0.8,
    approvalRiskThreshold: RiskLevel.HIGH,
    requireApprovalForTaskTypes: [],
  };

  const outcome: TaskOutcome = {
    taskType: "process-invoice",
    taskTypeAlwaysRequiresApproval: false,
    amount: 250,
    confidence: 0.95,
    assessedRisk: RiskLevel.LOW,
    workerRequestedReview: false,
  };

  it("auto-approves a low-risk, confident, in-limit outcome", () => {
    expect(evaluateApproval(policy, outcome)).toEqual({
      requiresApproval: false,
      riskLevel: RiskLevel.LOW,
      reasons: [],
    });
  });

  it("escalates amounts over the limit as HIGH risk", () => {
    const decision = evaluateApproval(policy, { ...outcome, amount: 1_500 });

    expect(decision.requiresApproval).toBe(true);
    expect(decision.riskLevel).toBe(RiskLevel.HIGH);
    expect(decision.reasons.join(" ")).toMatch(/exceeds the auto-approval limit/);
  });

  it("treats amounts at 10x the limit as CRITICAL", () => {
    expect(evaluateApproval(policy, { ...outcome, amount: 10_000 }).riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it("never escalates on amount when the limit is null", () => {
    const decision = evaluateApproval({ ...policy, autoApproveMaxAmount: null }, { ...outcome, amount: 1_000_000 });

    expect(decision.requiresApproval).toBe(false);
  });

  it("escalates any non-zero amount when the limit is 0", () => {
    const decision = evaluateApproval({ ...policy, autoApproveMaxAmount: 0 }, { ...outcome, amount: 1 });

    expect(decision.requiresApproval).toBe(true);
  });

  it("escalates low-confidence outcomes", () => {
    const decision = evaluateApproval(policy, { ...outcome, confidence: 0.5 });

    expect(decision.requiresApproval).toBe(true);
    expect(decision.reasons.join(" ")).toMatch(/Confidence 0.50/);
  });

  it("escalates when the worker's own risk assessment meets the threshold", () => {
    expect(evaluateApproval(policy, { ...outcome, assessedRisk: RiskLevel.HIGH }).requiresApproval).toBe(true);
    expect(evaluateApproval(policy, { ...outcome, assessedRisk: RiskLevel.MEDIUM }).requiresApproval).toBe(false);
  });

  it("always escalates sensitive task types and raises their risk to at least MEDIUM", () => {
    const decision = evaluateApproval(policy, { ...outcome, taskTypeAlwaysRequiresApproval: true });

    expect(decision.requiresApproval).toBe(true);
    expect(decision.riskLevel).toBe(RiskLevel.MEDIUM);
  });

  it("escalates task types the organization opted into", () => {
    const decision = evaluateApproval({ ...policy, requireApprovalForTaskTypes: ["process-invoice"] }, outcome);

    expect(decision.requiresApproval).toBe(true);
  });

  it("escalates when the worker asks for review", () => {
    expect(evaluateApproval(policy, { ...outcome, workerRequestedReview: true }).requiresApproval).toBe(true);
  });
});

describe("maxRisk", () => {
  it("returns the highest level", () => {
    expect(maxRisk(RiskLevel.LOW, RiskLevel.CRITICAL, RiskLevel.MEDIUM)).toBe(RiskLevel.CRITICAL);
  });
});

describe("resolvePolicy", () => {
  const defaults: ApprovalPolicy = {
    autoApproveMaxAmount: 100,
    minConfidence: 0.8,
    approvalRiskThreshold: RiskLevel.HIGH,
    requireApprovalForTaskTypes: [],
  };

  it("falls back to defaults for missing or malformed overrides", () => {
    expect(resolvePolicy(defaults, null)).toEqual(defaults);
    expect(resolvePolicy(defaults, { minConfidence: "high", approvalRiskThreshold: "EXTREME" })).toEqual(defaults);
  });

  it("applies valid overrides, including an explicit null limit", () => {
    expect(
      resolvePolicy(defaults, {
        autoApproveMaxAmount: null,
        approvalRiskThreshold: RiskLevel.MEDIUM,
        requireApprovalForTaskTypes: ["a", 1],
      }),
    ).toEqual({
      autoApproveMaxAmount: null,
      minConfidence: 0.8,
      approvalRiskThreshold: RiskLevel.MEDIUM,
      requireApprovalForTaskTypes: ["a"],
    });
  });
});
