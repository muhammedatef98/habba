/**
 * The documents the app hands people — تقرير هبّة, the inspection report and
 * the tax invoice — viewed in the app and shared as PDFs.
 *
 * ADR-0019: there is no public page and no link. Each document is produced on
 * the device from the frozen payload the database issued. It used to go only
 * one way, out through the share sheet, so reading your own report meant
 * sending it somewhere first. Now every document is one `ViewableDocument`
 * — a title, the HTML, a file name — which the in-app viewer shows and which
 * `shareDocumentPdf` prints to a PDF for the share sheet. The same HTML both
 * times: what the customer reads is exactly what they send.
 *
 * Two things worth knowing about the shape of this module:
 *
 * 1. **The rendering is not here.** The renderers live in `@habba/core` as
 *    pure functions, so every document is unit-tested in Node — file names
 *    included. What is left here is the part that needs a device: print to a
 *    file, rename it, open the share sheet.
 *
 * 2. **The filename is part of the product.** A share sheet shows it, and so
 *    does the recipient's downloads folder six weeks later. Expo names its
 *    output `<random>.pdf`, which is what an attachment nobody opens looks
 *    like. It is renamed to the car and the date, or the invoice number.
 */

import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  invoiceFileName,
  renderHabbaReportPdf,
  renderInspectionReport,
  renderInvoiceHtml,
  reportFileName,
  type HabbaReport,
  type InspectionReport,
  type InvoiceDocument,
} from '@habba/core';

export interface ViewableDocument {
  /** Shown over the viewer and as the share sheet's title. */
  readonly title: string;
  readonly html: string;
  readonly fileName: string;
}

export type ReportPdfResult =
  | { readonly ok: true; readonly uri: string; readonly fileName: string }
  | { readonly ok: false; readonly reason: 'render_failed' | 'sharing_unavailable' };

export function habbaReportDocument(report: HabbaReport, title: string): ViewableDocument {
  return { title, html: renderHabbaReportPdf(report), fileName: reportFileName(report) };
}

/**
 * The payload carries no customer identity, so a buyer forwarding it to the
 * seller — or a seller to the next buyer — shares only the car's condition.
 */
export function inspectionDocument(report: InspectionReport, title: string): ViewableDocument {
  const car = [report.subject.make_ar, report.subject.model_ar, report.subject.year]
    .filter((part) => part !== undefined && part !== '')
    .join('-');
  const fileName =
    `فحص-${car === '' ? 'سيارة' : car}-${report.completed_at.slice(0, 10)}.pdf`.replace(
      /\s+/g,
      '-',
    );
  return { title, html: renderInspectionReport(report), fileName };
}

export function invoiceDocument(invoice: InvoiceDocument, title: string): ViewableDocument {
  return { title, html: renderInvoiceHtml(invoice), fileName: invoiceFileName(invoice) };
}

/** Prints the document to an A4 PDF under its own name and returns the file. */
export async function createDocumentPdf(document: ViewableDocument): Promise<ReportPdfResult> {
  let printed: { uri: string };

  try {
    printed = await Print.printToFileAsync({
      html: document.html,
      // A4 at 72pt/inch — the page size the layouts are designed against
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

  // A rename failure is not worth failing the share over: the document is
  // correct either way, and someone standing next to a buyer would rather
  // send a badly named PDF than no PDF.
  try {
    const target = new File(Paths.cache, document.fileName);
    // A second document of the same name the same day would otherwise collide.
    if (target.exists) target.delete();
    await new File(printed.uri).move(target);
    return { ok: true, uri: target.uri, fileName: document.fileName };
  } catch {
    return { ok: true, uri: printed.uri, fileName: document.fileName };
  }
}

/** The PDF, out through the platform's share sheet: WhatsApp, AirDrop, Files, print. */
export async function shareDocumentPdf(document: ViewableDocument): Promise<ReportPdfResult> {
  const created = await createDocumentPdf(document);
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
    dialogTitle: document.title,
  });

  return created;
}

export function shareHabbaReportPdf(report: HabbaReport): Promise<ReportPdfResult> {
  return shareDocumentPdf(habbaReportDocument(report, 'تقرير هبّة'));
}

export function shareInspectionPdf(report: InspectionReport): Promise<ReportPdfResult> {
  return shareDocumentPdf(inspectionDocument(report, 'تقرير الفحص'));
}
