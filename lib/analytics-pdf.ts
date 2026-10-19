import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatMetric,
  metricKeys,
  metricDefinitions,
  platforms,
  sourceLabels,
  type SavedReport,
} from "./analytics";
let fontBytes: Promise<Buffer> | undefined;
export async function analyticsPDF(report: SavedReport) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await (fontBytes ??= readFile(
      join(process.cwd(), "assets/fonts/DejaVuSans.ttf"),
    )),
    { subset: true },
  );
  const created = new Date(report.created_at);
  doc.setTitle(report.title);
  doc.setAuthor("Agência ION");
  doc.setCreator("ION OS");
  doc.setProducer("ION Analytics");
  doc.setCreationDate(created);
  doc.setModificationDate(created);
  const accent = rgb(0.63, 0.48, 1),
    white = rgb(0.94, 0.94, 0.96),
    muted = rgb(0.67, 0.67, 0.72);
  let page!: PDFPage,
    y = 0;
  let number = 0;
  function newPage() {
    page = doc.addPage([595.28, 841.89]);
    number++;
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
      color: rgb(0.043, 0.043, 0.055),
    });
    page.drawText("ION / OS", { x: 40, y: 804, size: 16, font, color: accent });
    page.drawText("ION ANALYTICS", {
      x: 380,
      y: 806,
      size: 9,
      font,
      color: muted,
    });
    page.drawText("Agência ION · " + number, {
      x: 40,
      y: 24,
      size: 8,
      font,
      color: muted,
    });
    y = 770;
  }
  function text(value: string, size = 10, color = white) {
    const words = value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .split(/\s+/);
    let line = "";
    for (const word of words) {
      if (font.widthOfTextAtSize(line + " " + word, size) > 510 && line) {
        write(line, size, color);
        line = "";
      }
      if (font.widthOfTextAtSize(word, size) > 510) {
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > 510) {
            write(line, size, color);
            line = "";
          }
          line += char;
        }
      } else line += (line ? " " : "") + word;
    }
    if (line) write(line, size, color);
    y -= 5;
  }
  function write(line: string, size: number, color = white) {
    if (y < 55) newPage();
    page.drawText(line, { x: 40, y, size, font, color });
    y -= size + 6;
  }
  newPage();
  text(report.title, 19, accent);
  text(report.company, 14);
  text(
    report.view === "published"
      ? "VERSÃO PUBLICADA PARA CONSULTA"
      : "RELATÓRIO INTERNO — PUBLICAÇÃO NÃO AUTOMÁTICA",
    9,
    accent,
  );
  text(`Período: ${report.snapshot.from} a ${report.snapshot.to}`);
  text(
    "Gerado em " +
      created.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) +
      " (America/Sao_Paulo)",
    9,
    muted,
  );
  text("Identificador auditável: " + report.id, 8, muted);
  const s = report.snapshot;
  text(
    `${s.record_count} observação(ões) real(is). ${s.partial_count} intervalo(s) parcial(is) excluído(s), sem rateio.`,
    9,
    muted,
  );
  text("Indicadores", 14, accent);
  for (const key of metricKeys) {
    if (!Object.hasOwn(s.stats, key)) continue;
    text(
      metricDefinitions[key].label + ": " + formatMetric(key, s.stats[key]),
      11,
    );
    text(metricDefinitions[key].definition, 8, muted);
    if (s.comparison)
      text(
        "Anterior: " +
          formatMetric(key, s.comparison.stats[key]) +
          (s.comparison_change?.changes[key]?.percent !== null &&
          s.comparison_change?.changes[key]?.percent !== undefined
            ? " · variação " + s.comparison_change.changes[key]!.percent + "%"
            : " · sem base comparável"),
        8,
        muted,
      );
  }
  if (s.comparison) {
    text(
      `Comparação: ${s.comparison.from} a ${s.comparison.to} · ${s.comparison.record_count} observação(ões).`,
      10,
      accent,
    );
    text(
      s.comparison_change?.compatible
        ? "Mesmas contas de origem; variações só são calculadas entre valores conhecidos."
        : "Origens diferentes ou sem dados: nenhuma variação percentual é inferida.",
      9,
      muted,
    );
  }
  text("Metodologia", 13, accent);
  text(s.methodology, 9, muted);
  for (const g of s.groups) {
    text(g.account + " · " + platforms[g.platform], 13, accent);
    text(g.attribution + " · " + g.time_zone, 9, muted);
    for (const key of metricKeys.filter((k) => Object.hasOwn(g.stats, k)))
      text(
        metricDefinitions[key].label + ": " + formatMetric(key, g.stats[key]),
        9,
      );
  }
  // Plot observed endpoints only. Never manufacture daily data or interpolate missing measures.
  const chartMetric = metricKeys.find((k) =>
    s.points.some((p) => p.stats[k] !== null && p.stats[k] !== undefined),
  );
  const points = s.points.filter(
    (p) =>
      chartMetric &&
      p.stats[chartMetric] !== null &&
      p.stats[chartMetric] !== undefined,
  );
  if (points.length) {
    newPage();
    text("Evolução · " + metricDefinitions[chartMetric!].label, 15, accent);
    text(
      "Pontos representam observações reais por conta e período, sem rateio ou preenchimento de lacunas.",
      9,
      muted,
    );
    const chartY = y - 230;
    const start = Date.parse(s.from),
      span = Math.max(86400000, Date.parse(s.to) - start);
    const cents = (v: string) => {
      const [a, b = ""] = v.split(".");
      return BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
    };
    const max = points.reduce((m, p) => {
      const n = cents(p.stats[chartMetric!]!);
      return n > m ? n : m;
    }, 1n);
    const ids = [...new Set(points.map((p) => p.account_id))];
    for (const [i, id] of ids.entries()) {
      const series = points.filter((p) => p.account_id === id);
      let prev: { x: number; y: number } | undefined;
      for (const p of series) {
        const x =
            40 +
            Math.max(0, Math.min(1, (Date.parse(p.to) - start) / span)) * 500,
          py =
            chartY +
            Number((cents(p.stats[chartMetric!]!) * 20000n) / max) / 100;
        if (prev)
          page.drawLine({
            start: prev,
            end: { x, y: py },
            color: i % 2 ? muted : accent,
            thickness: 1,
          });
        page.drawCircle({ x, y: py, size: 2, color: i % 2 ? muted : accent });
        prev = { x, y: py };
      }
    }
    page.drawLine({
      start: { x: 40, y: chartY },
      end: { x: 540, y: chartY },
      color: muted,
      thickness: 0.5,
    });
    y = chartY - 15;
    text(s.from + " — " + s.to, 9, muted);
    for (const g of s.groups)
      text(g.account + " · " + g.attribution + " · " + g.time_zone, 9, muted);
  }
  text("Origem das informações", 13, accent);
  const sources = new Map<
    string,
    { label: string; n: number; updated: string }
  >();
  for (const row of s.sources) {
    const key = row.account_id + "|" + row.source_kind;
    const v = sources.get(key) ?? {
      label:
        row.account +
        " · " +
        platforms[row.platform] +
        " · " +
        sourceLabels[row.source_kind],
      n: 0,
      updated: row.updated_at,
    };
    v.n++;
    if (row.updated_at > v.updated) v.updated = row.updated_at;
    sources.set(key, v);
  }
  for (const row of sources.values())
    text(
      row.label +
        ` · ${row.n} registro(s) · atualizado em ` +
        new Date(row.updated).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        }),
      9,
      muted,
    );
  text(
    "Este PDF apresenta o resumo do snapshot persistido. As observações e referências completas permanecem no ION OS, respeitando as permissões de consulta. Nenhuma integração automática é presumida. Investimento publicitário do cliente não é receita nem despesa interna da Agência ION.",
    9,
    muted,
  );
  return doc.save();
}
