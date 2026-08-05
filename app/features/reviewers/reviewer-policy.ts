export interface ReviewerApplicationInput {
  statement: string;
  occupation: string;
  tasteDirection: string;
  regionCode: "GWANGJU" | "JEONNAM";
  specialtySlugs: string[];
}

export function validateReviewerApplication(input: ReviewerApplicationInput) {
  const errors: Partial<Record<keyof ReviewerApplicationInput, string>> = {};
  const statementLength = input.statement.trim().length;
  if (statementLength < 100 || statementLength > 1000) errors.statement = "의견서는 100자 이상 1,000자 이하로 작성하세요.";
  if (!input.occupation.trim() || input.occupation.trim().length > 80) errors.occupation = "직업 또는 활동 소개를 1자 이상 80자 이하로 작성하세요.";
  if (!input.tasteDirection.trim() || input.tasteDirection.trim().length > 200) errors.tasteDirection = "취향 방향을 1자 이상 200자 이하로 작성하세요.";
  if (input.regionCode !== "GWANGJU" && input.regionCode !== "JEONNAM") errors.regionCode = "활동 지역을 선택하세요.";
  const specialties = [...new Set(input.specialtySlugs.filter(Boolean))];
  if (specialties.length < 1 || specialties.length > 3) errors.specialtySlugs = "전문 카테고리를 1개 이상 3개 이하로 선택하세요.";
  return errors;
}

export function isDormantAt(lastActivityAt: string, now: string) {
  const threshold = 90 * 24 * 60 * 60 * 1000;
  return new Date(now).getTime() - new Date(lastActivityAt).getTime() >= threshold;
}
