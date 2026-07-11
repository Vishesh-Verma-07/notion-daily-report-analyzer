import { Client } from "@notionhq/client";
import { compareReportDates } from "./date";
import type { DatedReports } from "./types";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

async function listAllChildren(blockId: string) {
  const allBlocks: any[] = [];

  async function traverse(id: string) {
    let cursor: string | undefined;

    do {
      const response = await notion.blocks.children.list({
        block_id: id,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const block of response.results) {
        allBlocks.push(block);

        
        if ("has_children" in block && block.has_children) {
          await traverse(block.id);
        }
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);
  }

  await traverse(blockId);

  return allBlocks;
}

function blockToText(block: any): string {
  const richText = block[block.type]?.rich_text;

  if (!richText) return "";

  const text = richText
    .map((item: any) => item.plain_text)
    .join("")
    .trim();

  if (!text) return "";

  switch (block.type) {
    case "paragraph":
      return text;

    case "numbered_list_item":
      return `1. ${text}`;

    case "bulleted_list_item":
      return `- ${text}`;

    case "to_do":
      return `- [ ] ${text}`;

    default:
      return text;
  }
}

type ReportMap = Map<string, string>;

function extractReportsByDate(text: string): ReportMap {
  const reports = new Map<string, string>();

  let currentDate: string | null = null;
  let currentLines: string[] = [];

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^Date:-?\s*(.+)$/i);

    if (match) {
      // Save previous report
      if (currentDate) {
        reports.set(
          currentDate,
          `Date:- ${currentDate}\n${currentLines.join("\n")}`
        );
      }

      if(!match[1])
        continue;

      currentDate = match[1].trim();
      currentLines = [];
      continue;
    }

    if (currentDate) {
      currentLines.push(line);
    }
  }

  // Save last report
  if (currentDate) {
    reports.set(
      currentDate,
      `Date:- ${currentDate}\n${currentLines.join("\n")}`
    );
  }

  return reports;
}

async function getReportsByDate(pageId: string): Promise<ReportMap> {
  if (!pageId) {
    throw new Error("Missing Notion page id for a report source.");
  }

  const blocks = await listAllChildren(pageId);
  const text = blocks.map(blockToText).filter(Boolean).join("\n");

  // console.log(blocks);
  for (const block of blocks) {
    if (!('type' in block)) continue; 

    console.log("TYPE:", block.type);
    console.log("TEXT:", blockToText(block));
    console.log("----------------");
  }

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
