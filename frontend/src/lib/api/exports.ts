import { api } from "@/lib/api";
import { httpDownload, httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface FigureEntry {
  number: string;
  name: string;
  chapter: string;
  where: string;
  caption: string;
  formats: string[];
  bytes: Record<string, number>;
}

export interface Figures {
  figures: FigureEntry[];
  chapters: Array<{ chapter: string; figures: number }>;
  total: number;
  provenance: Provenance;
  reading: string;
}

export interface TableEntry {
  name: string;
  title: string;
  detail: string;
  artifact: string;
  available: boolean;
}

export interface Tables {
  tables: TableEntry[];
  provenance: Provenance;
  reading: string;
}

export interface ReproductionReport {
  markdown: string;
  sections: string[];
  bytes: number;
  provenance: Provenance;
  reading: string;
}

export const getFigures = () => httpGet<Figures>("/exports/figures");
export const getTables = () => httpGet<Tables>("/exports/tables");
export const getReproductionReport = () => httpGet<ReproductionReport>("/exports/reproduction-report");

export const downloadFigure = (name: string, format: string) =>
  httpDownload("/exports/figure", `${name}.${format}`, { name, format });
export const downloadTable = (name: string) =>
  httpDownload("/exports/table", `gridsentinel-${name}.csv`, { name });

/**
 * A figure's bytes, fetched through the console's client so the API key header is sent.
 * A bare <img src> would miss that header and break wherever keys are enforced.
 */
export async function fetchFigure(name: string, format = "png"): Promise<Blob> {
  const response = await api.get<Blob>("/exports/figure", { params: { name, format }, responseType: "blob" });
  return response.data;
}
