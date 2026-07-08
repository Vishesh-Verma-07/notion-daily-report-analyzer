export function parseReportDate(date: string) {
  const trimmed = date.trim();
  const ddMmYyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const yyyyMmDd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  const parts = ddMmYyyy
    ? {
        day: Number(ddMmYyyy[1]),
        month: Number(ddMmYyyy[2]),
        year: Number(ddMmYyyy[3]),
      }
    : yyyyMmDd
      ? {
          day: Number(yyyyMmDd[3]),
          month: Number(yyyyMmDd[2]),
          year: Number(yyyyMmDd[1]),
        }
      : null;

  if (!parts) {
    return null;
  }

  const time = Date.UTC(parts.year, parts.month - 1, parts.day);
  const parsed = new Date(time);

  if (
    parsed.getUTCFullYear() !== parts.year ||
    parsed.getUTCMonth() !== parts.month - 1 ||
    parsed.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return time;
}

export function compareReportDates(left: string, right: string) {
  const leftTime = parseReportDate(left);
  const rightTime = parseReportDate(right);

  if (leftTime !== null && rightTime !== null) {
    return leftTime - rightTime;
  }

  if (leftTime !== null) {
    return -1;
  }

  if (rightTime !== null) {
    return 1;
  }

  return left.localeCompare(right);
}
