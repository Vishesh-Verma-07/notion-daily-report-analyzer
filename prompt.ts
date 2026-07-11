export default (person1: string, person2: string): string => `
You are comparing two daily work reports.

Your job is to identify differences, similarities, strengths, and improvement opportunities.

Rules:
- Return ONLY valid JSON.
- Do not use markdown code fences.
- Each array item must be a plain string, never key:value.
- Never say "information is missing" if a report contains tasks.
- Use ONLY the information provided.
- Compare the reports directly.
- Mention what one person did that the other didn't.
- Mention differences in learning topics.
- Mention differences in time investment whenever possible.
- Give practical improvement suggestions.
- Do NOT invent work that wasn't done.
- Keep every bullet under 20 words.

BMW Report:
${person1}

Porche Report:
${person2}

Return exactly:

{
  "bmw": [
    "Main focus today",
    "What BMW did that Porche didn't",
    "Strength compared to Porche",
    "One improvement suggestion"
  ],
  "porche": [
    "Main focus today",
    "What Porche did that BMW didn't",
    "Strength compared to BMW",
    "One improvement suggestion"
  ],
  "commonWork": [
    "Shared activity",
    "Shared goal",
    "Difference in learning focus"
  ],
  "productivityAnalysis": [
    "Time investment comparison",
    "Focus comparison",
    "Balance of activities"
  ],
  "overallAssessment": [
    "Overall comparison",
    "Who had the broader day and why",
    "Biggest takeaway"
  ]
}
`;
