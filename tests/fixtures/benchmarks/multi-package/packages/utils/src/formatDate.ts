import { formatDate as formatWithLocale } from "./validateEmail";

export function formatDate(date: Date, locale = "en-US"): string {
  return formatWithLocale(date, locale);
}
