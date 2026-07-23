// ============================================================================
// Deal Analyzer / Offer Calculator — MAO, wholesale spread, flip profit,
// rental & BRRRR analysis, and a strategy recommendation.
// ============================================================================

import type { DealAnalysis } from "@dealengine/shared";

export interface AnalyzerInput {
  leadId: string;
  arvCents: number;
  repairsCents: number;
  /** Default 0.70 — configurable per market/price band. */
  maoRulePct?: number;
  /** Target assignment fee for wholesale (default $12,500). */
  assignmentFeeCents?: number;
  /** Months to hold for a flip (default 5). */
  holdMonths?: number;
  /** Estimated monthly market rent, if known. */
  rentEstimateCents?: number | null;
  /** Seller's asking price if the conversation surfaced one. */
  askingPriceCents?: number | null;
  /** Property tax + insurance monthly estimate (default derived from ARV). */
  monthlyCarryCents?: number;
}

export type DealAnalysisFull = DealAnalysis & { brrrr: Record<string, number> | null };

export function analyzeDeal(input: AnalyzerInput): DealAnalysisFull {
  const maoRulePct = input.maoRulePct ?? 0.7;
  const assignmentFee = input.assignmentFeeCents ?? 1_250_000; // $12,500
  const holdMonths = input.holdMonths ?? 5;

  const arv = input.arvCents;
  const repairs = input.repairsCents;

  // --- Holding costs (flip): taxes+insurance+utilities + hard money interest
  const monthlyCarry =
    input.monthlyCarryCents ?? Math.round((arv * 0.02) / 12 + 25_000); // ~2%/yr T&I + $250 utils
  const purchaseBasis = Math.max(arv * maoRulePct - repairs, 0);
  const hardMoneyMonthly = Math.round(((purchaseBasis + repairs) * 0.11) / 12); // 11% APR
  const holdingCents = Math.round((monthlyCarry + hardMoneyMonthly) * holdMonths);

  // --- Closing costs: buy side ~2% of purchase, sell side ~7% of ARV (agent+concessions)
  const closingBuy = Math.round(purchaseBasis * 0.02);
  const closingSell = Math.round(arv * 0.07);
  const closingCents = closingBuy + closingSell;

  // --- MAO (wholesale): what YOU can offer and still assign with your fee
  const maoCents = Math.max(Math.round(arv * maoRulePct - repairs - assignmentFee), 0);

  // --- Wholesale spread: end-buyer pays 70% rule; your spread is the fee
  const endBuyerPrice = Math.round(arv * maoRulePct - repairs);
  const wholesaleSpreadCents = Math.max(endBuyerPrice - maoCents, 0);

  // --- Flip profit if YOU flipped at MAO purchase
  const flipProfitCents =
    arv - (maoCents + repairs + holdingCents + closingCents);

  // --- Rental / BRRRR ------------------------------------------------------
  let cocReturn: number | null = null;
  let brrrr: Record<string, number> | null = null;
  const rent = input.rentEstimateCents ?? null;
  if (rent != null && rent > 0) {
    const annualRent = rent * 12;
    const annualOpex = Math.round(annualRent * 0.45); // 45% expense ratio (taxes, ins, mgmt, maint, vacancy)
    const noi = annualRent - annualOpex;

    // BRRRR: refi at 75% LTV of ARV, 7.5% 30yr
    const refiLoan = Math.round(arv * 0.75);
    const totalIn = maoCents + repairs + closingBuy + Math.round(holdingCents / 2);
    const cashLeftIn = Math.max(totalIn - refiLoan, 0);
    const annualDebtService = Math.round(refiLoan * 0.0839); // 7.5% 30yr constant
    const annualCashflow = noi - annualDebtService;
    cocReturn = cashLeftIn > 0 ? annualCashflow / cashLeftIn : annualCashflow > 0 ? 99 : 0;

    brrrr = {
      refi_loan_cents: refiLoan,
      total_cash_in_cents: totalIn,
      cash_left_in_cents: cashLeftIn,
      noi_cents: noi,
      annual_debt_service_cents: annualDebtService,
      annual_cashflow_cents: annualCashflow,
    };
  } else {
    brrrr = null;
  }

  // --- Strategy recommendation --------------------------------------------
  let strategy: DealAnalysis["strategy"];
  const flipMarginPct = arv > 0 ? flipProfitCents / arv : 0;
  if (maoCents <= 0 || arv <= 0) {
    strategy = "pass";
  } else if (input.askingPriceCents != null && input.askingPriceCents > endBuyerPrice * 1.15) {
    strategy = "pass"; // seller expectations far above any workable number
  } else if (rent != null && cocReturn != null && cocReturn >= 0.12) {
    strategy = "brrrr";
  } else if (flipMarginPct >= 0.15 && flipProfitCents >= 3_000_000) {
    strategy = "flip";
  } else if (wholesaleSpreadCents >= 800_000) {
    strategy = "wholesale";
  } else {
    strategy = "pass";
  }

  return {
    leadId: input.leadId,
    arvCents: arv,
    repairsCents: repairs,
    maoCents,
    maoRulePct,
    holdingCents,
    closingCents,
    assignmentFeeCents: assignmentFee,
    wholesaleSpreadCents,
    flipProfitCents,
    rentEstimateCents: rent,
    cocReturn,
    strategy,
    brrrr,
  };
}

/**
 * Adaptive MAO rule: thin-margin price bands need a stricter rule; expensive
 * ones can loosen slightly because fixed costs are proportionally smaller.
 */
export function maoRuleForArv(arvCents: number): number {
  const arv = arvCents / 100;
  if (arv < 100_000) return 0.65;
  if (arv < 250_000) return 0.7;
  if (arv < 400_000) return 0.72;
  return 0.75;
}
