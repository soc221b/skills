type ExportFormat = "csv" | "json";

function getExportMimeType(format: ExportFormat): string {
  if (format === "csv") {
    return "text/csv";
  } else {
    return "application/json";
  }
}
