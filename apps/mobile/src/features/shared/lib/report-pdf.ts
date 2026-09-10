/**
 * Turning تقرير هبّة into a file the owner can hand to a buyer.
 *
 * ADR-0019: there is no public page and no link. The document is produced on
 * the device from the frozen payload the database issued, and shared as a PDF
 * through the platform's own share sheet — WhatsApp, AirDrop, email, print.
 *
 * Two things worth knowing about the shape of this module:
 *
 * 1. **The rendering is not here.** `renderHabbaReportPdf` lives in
 *    `@habba/core` as a pure function, so the whole document is unit-tested in
 *    Node — `reportFileName` included, since a file name is a string. What is
 *    left here is the part that genuinely needs a device: print to a file,
 *    rename it, open the share sheet.
 *
 * 2. **The filename is part of the product.** A share sheet shows the file
 *    name, and so does the buyer's downloads folder six weeks later. Expo
 *    names its output `<random>.pdf`, which is what an attachment nobody opens
 *    looks like. It is renamed to the car and the date.
 */

import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { renderHabbaReportPdf, reportFileName, type HabbaReport } from '@habba/core';

export type ReportPdfResult =
  | { readonly ok: true; readonly uri: string; readonly fileName: string }
  | { readonly ok: false; readonly reason: 'render_failed' | 'sharing_unavailable' };

/**
 * Renders the report to a PDF on the device and returns its file URI.
 *
 * Exported separately from `shareHabbaReportPdf` so a caller can print rather
 * than share — `Print.printAsync` takes the same HTML — and so the failure
 * modes stay distinguishable in the UI.
 */
export async function createHabbaReportPdf(report: HabbaReport): Promise<ReportPdfResult> {
  let printed: { uri: string };

  try {
    printed = await Print.printToFileAsync({
      html: renderHabbaReportPdf(report),
      // A4 at 72pt/inch — the page size the layout is designed against
      // (docs/design/report-pdf.md). Left to the platform default it would be
      // US Letter on a device set to a US locale, which reflows the whole
      // document for a market that will never see it.
      width: 595,
      height: 842,
      base64: false,
    });
  } catch {
    return { ok: false, reason: 'render_failed' };
  }

  const fileName = reportFileName(report);

  // A rename failure is not worth failing the share over: the document is
  // correct either way, and an owner standing next to a buyer would rather
  // send a badly named PDF than no PDF.
  try {
    const target = new File(Paths.cache, fileName);
    // A second report on the same car, the same day, would otherwise collide.
    if (target.exists) target.delete();

    const source = new File(printed.uri);
    await source.move(target);
    return { ok: true, uri: target.uri, fileName };
  } catch {
    return { ok: true, uri: printed.uri, fileName };
  }
}

export async function shareHabbaReportPdf(report: HabbaReport): Promise<ReportPdfResult> {
  const created = await createHabbaReportPdf(report);
  if (!created.ok) return created;

  if (!(await Sharing.isAvailableAsync())) {
    // The file exists and is valid; only the share sheet is missing (a
    // simulator, or a locked-down device). The caller says so rather than
    // reporting a failure to generate.
    return { ok: false, reason: 'sharing_unavailable' };
  }

  await Sharing.shareAsync(created.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'تقرير هبّة',
  });

  return created;
}
