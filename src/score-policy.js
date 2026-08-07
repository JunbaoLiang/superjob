export function isSplitScore(score) {
  return Boolean(score?.eligibility && score?.match);
}

/** 只有 JD 明确的即时不合格条件可自动移至 skip。 */
export function shouldAutoSkip(score) {
  return isSplitScore(score) && score.eligibility.verdict === "ineligible";
}

/** 批量生成只处理主投和海投；stretch/待核实必须由用户点选。 */
export function canAutoGenerateMaterials(score) {
  return isSplitScore(score) && ["main_target", "mass_apply"].includes(score.recommendation);
}

export function assertCanGenerateMaterials(score) {
  if (shouldAutoSkip(score)) throw new Error("该职位存在明确 eligibility hard block，不能生成投递材料。");
}

/** 兼容冻结的旧评分；新评分仅 mass_apply 使用通用海投角度。 */
export function usesMassApplyAngle(score) {
  return isSplitScore(score) ? score.recommendation === "mass_apply" : score?.verdict === "skip";
}

export function scoreView(score) {
  if (!score) return null;
  if (!isSplitScore(score)) {
    return {
      legacy: true,
      eligibility: null,
      match: { score: score.score, verdict: score.verdict, rationale: score.rationale || [], gaps: score.gaps || [], strengths: score.strengths || [], resume_angle: score.resume_angle || "" },
      recommendation: null,
      hard_blockers: score.hard_blockers || [],
      risks: [],
      checks: [],
    };
  }
  return {
    legacy: false,
    eligibility: score.eligibility.verdict,
    match: score.match,
    recommendation: score.recommendation,
    hard_blockers: score.eligibility.hard_blockers,
    risks: score.eligibility.risks,
    checks: score.eligibility.checks,
  };
}
