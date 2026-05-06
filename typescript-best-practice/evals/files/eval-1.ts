type ExportFormat = "csv" | "json";

function getExportMimeType(format: ExportFormat): string {
  switch (format) {
    case "csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}
