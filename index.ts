import { GoogleGenAI } from "@google/genai";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { parseReportDate } from "./date";
import { getReports } from "./fetch";
import getPrompt from "./prompt";
import type { ComparisonResult } from "./types";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const databaseId = process.env.AI_COMPARISONS_DATABASE_ID;
let comparisonDataSourceId: string | undefined;

function extractBalancedJsonObject(text: string) {
  let inString = false;
  let isEscaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function parseMalformedStructuredText(text: string): ComparisonResult | null {
  const required: Array<keyof ComparisonResult> = [
    "bmw",
    "porche",
    "commonWork",
    "productivityAnalysis",
    "overallAssessment",
  ];

  const result: Partial<ComparisonResult> = {};

  for (const key of required) {
    const sectionMatch = text.match(
      new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i"),
    );

    if (!sectionMatch?.[1]) {
      return null;
    }

    const body = sectionMatch[1];
    const colonValueMatches = Array.from(
      body.matchAll(/:\s*"((?:\\.|[^"\\])*)"/g),
    ).map((match) => decodeJsonString(match[1] as string));

    if (colonValueMatches.length > 0) {
      result[key] = colonValueMatches;
      continue;
    }

    const stringMatches = Array.from(body.matchAll(/"((?:\\.|[^"\\])*)"/g)).map(
      (match) => decodeJsonString(match[1] as string),
    );

    if (stringMatches.length === 0) {
      return null;
    }

    result[key] = stringMatches;
  }

  if (
    required.every(
      (key) => Array.isArray(result[key]) && (result[key]?.length ?? 0) > 0,
    )
  ) {
    return result as ComparisonResult;
  }

  return null;
}

function parseComparisonJson(text: string): ComparisonResult {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  const candidates: string[] = [];
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  const keyHintIndex = Math.min(
    ...['"bmw"', '"porche"', '"commonWork"', '"overallAssessment"']
      .map((key) => trimmed.indexOf(key))
      .filter((index) => index >= 0),
  );

  if (Number.isFinite(keyHintIndex)) {
    const fromKey = trimmed.slice(keyHintIndex);
    const keyCandidate = extractBalancedJsonObject(fromKey);
    if (keyCandidate) {
      candidates.push(keyCandidate);
    }
  }

  const balancedCandidate = extractBalancedJsonObject(trimmed);
  if (balancedCandidate) {
    candidates.push(balancedCandidate);
  }

  candidates.push(trimmed);

  let parsed: any;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!parsed) {
    const repaired = parseMalformedStructuredText(trimmed);
    if (repaired) {
      return repaired;
    }

    console.error("Invalid JSON received from Gemini:");
    console.error(trimmed);
    throw lastError instanceof Error
      ? lastError
      : new Error("Gemini response did not contain valid JSON.");
  }

  const required = [
    "bmw",
    "porche",
    "commonWork",
    "productivityAnalysis",
    "overallAssessment",
  ];

  for (const key of required) {
    if (!Array.isArray(parsed[key as keyof ComparisonResult])) {
      throw new Error(`Missing field: ${key}`);
    }
  }

  return parsed;
}

function bulletsToText(bullets: string[]) {
  return bullets.map((bullet) => `- ${bullet}`).join("\n");
}

async function generateComparison(
  person1: string,
  person2: string,
): Promise<ComparisonResult> {
  const prompt = getPrompt(person1, person2);
  // console.log(prompt)

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty response.");
  }

  return parseComparisonJson(response.text);
}

async function getComparisonDataSourceId() {
  if (comparisonDataSourceId) {
    return comparisonDataSourceId;
  }

  if (!databaseId) {
    throw new Error("Missing AI_COMPARISONS_DATABASE_ID.");
  }

  const database = await notion.databases.retrieve({
    database_id: databaseId,
  });

  const dataSourceId =
    "data_sources" in database ? database.data_sources?.[0]?.id : undefined;

  if (!dataSourceId) {
    throw new Error(
      "The comparisons database does not expose a data source for queries.",
    );
  }

  comparisonDataSourceId = dataSourceId;
  return dataSourceId;
}

function getTitleValue(
  page: { properties?: Record<string, any> },
  propertyName: string,
) {
  const property = page.properties?.[propertyName];

  if (!property || !Array.isArray(property.title)) {
    return "";
  }

  return property.title.map((item: any) => item.plain_text ?? "").join("");
}

async function getLastComparedDate() {
  const dataSourceId = await getComparisonDataSourceId();
  let cursor: string | undefined;
  let latestDate: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  do {
    const result = await notion.dataSources.query({
      data_source_id: dataSourceId,
      result_type: "page",
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of result.results) {
      const date = getTitleValue(
        page as { properties?: Record<string, any> },
        "Date",
      );
      const time = parseReportDate(date);

      if (time !== null && time > latestTime) {
        latestDate = date;
        latestTime = time;
      }
    }

    cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return latestDate;
}

function isAfterComparedDate(candidateDate: string, comparedDate: string) {
  const candidateTime = parseReportDate(candidateDate);
  const comparedTime = parseReportDate(comparedDate);

  if (candidateTime !== null && comparedTime !== null) {
    return candidateTime > comparedTime;
  }

  return candidateDate > comparedDate;
}

async function findExistingComparison(date: string) {
  const dataSourceId = await getComparisonDataSourceId();

  const result = await notion.dataSources.query({
    data_source_id: dataSourceId,
    result_type: "page",
    page_size: 1,
    filter: {
      property: "Date",
      title: {
        equals: date,
      },
    },
  });

  return result.results[0] ?? null;
}

async function upsertComparison(date: string, aiResult: ComparisonResult) {
  if (!databaseId) {
    throw new Error("Missing AI_COMPARISONS_DATABASE_ID.");
  }

  const existing = await findExistingComparison(date);

  const properties = {
    Date: {
      title: [
        {
          text: {
            content: date,
          },
        },
      ],
    },

    BMW: {
      rich_text: [
        {
          text: {
            content: bulletsToText(aiResult.bmw),
          },
        },
      ],
    },

    Porche: {
      rich_text: [
        {
          text: {
            content: bulletsToText(aiResult.porche),
          },
        },
      ],
    },

    "Common Work": {
      rich_text: [
        {
          text: {
            content: bulletsToText(aiResult.commonWork),
          },
        },
      ],
    },

    "Productivity Analysis": {
      rich_text: [
        {
          text: {
            content: bulletsToText(aiResult.productivityAnalysis),
          },
        },
      ],
    },

    "Overall Assessment": {
      rich_text: [
        {
          text: {
            content: bulletsToText(aiResult.overallAssessment),
          },
        },
      ],
    },
  };

  if (existing) {
    await notion.pages.update({
      page_id: existing.id,
      properties,
    });

    return { action: "updated", pageId: existing.id };
  }

  const created = await notion.pages.create({
    parent: {
      database_id: databaseId,
    },
    properties,
  });

  return { action: "created", pageId: created.id };
}

async function main() {
  const datedReports = await getReports();
  const results = [];
  const lastComparedDate = await getLastComparedDate();
  const reportsToProcess = lastComparedDate
    ? datedReports.filter((report) =>
        isAfterComparedDate(report.date, lastComparedDate),
      )
    : datedReports;

  if (lastComparedDate && reportsToProcess.length === 0) {
    console.log(
      JSON.stringify(
        {
          message: "No new report dates found after the last compared date.",
          lastComparedDate,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const reports of reportsToProcess) {
    const comparison = await generateComparison(
      reports.bmwReport,
      reports.porcheReport,
    );
    const result = await upsertComparison(reports.date, comparison);

    results.push({
      date: reports.date,
      action: result.action,
      pageId: result.pageId,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

await main();
