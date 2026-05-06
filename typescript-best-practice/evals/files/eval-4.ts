type ConnectionState = "connecting" | "connected" | "reconnecting" | "ready";

function getConnectionBadgeLabel(state: ConnectionState): string {
  switch (state) {
    case "connecting":
    case "reconnecting":
      return "Connecting";
    default:
      return "Available";
  }
}
