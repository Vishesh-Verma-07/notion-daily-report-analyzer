import { Client } from "@notionhq/client";
import { compareReportDates } from "./date";
import type { DatedReports } from "./types";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

async function listAllChildren(blockId: string) {
  const blocks = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    blocks.push(...response.results);
    cursor = response.has_more
      ? (response.next_cursor ?? undefined)
      : undefined;
  } while (cursor);

  return blocks;
}

function blockToText(block: any): string {
  if ("paragraph" in block && block.paragraph?.rich_text) {
    return block.paragraph.rich_text
      .map((item: any) => item.plain_text)
      .join("");
  }

  return "";
}

type ReportMap = Map<string, string>;

function extractReportsByDate(text: string): ReportMap {
  const reports: ReportMap = new Map();
  const matches = [...text.matchAll(/Date:\s*([^\n\r]+)([\s\S]*?)(?=Date:|$)/gi)];

  for (const match of matches) {
    const rawDate = match[1]?.trim();
    const body = match[2]?.trim() ?? "";

    if (!rawDate) {
      continue;
    }

    reports.set(rawDate, `Date: ${rawDate}${body ? `\n${body}` : ""}`);
  }

  return reports;
}

async function getReportsByDate(pageId: string): Promise<ReportMap> {
  if (!pageId) {
    throw new Error("Missing Notion page id for a report source.");
  }

  const blocks = await listAllChildren(pageId);
  const text = blocks.map(blockToText).filter(Boolean).join("\n");

  return extractReportsByDate(text);
}

const getReports = async (): Promise<DatedReports[]> => {
  const [bmwReports, porcheReports] = await Promise.all([
    getReportsByDate(process.env.BMW_PAGE_ID || ""),
    getReportsByDate(process.env.PORCHE_PAGE_ID || ""),
  ]);

  const dates = [
    ...new Set([...bmwReports.keys(), ...porcheReports.keys()]),
  ].sort(compareReportDates);

  return dates.map((date) => ({
    date,
    bmwReport: bmwReports.get(date) ?? "No BMW report submitted for this date.",
    porcheReport: porcheReports.get(date) ?? "No Porche report submitted for this date.",
  }));
};

export { getReports };
