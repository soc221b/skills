type UserRole = "admin" | "member";

function getUserRoleDescription(role: UserRole): string {
  switch (role) {
    case "admin":
      return "Can manage users and projects";
    case "member":
      return "Can edit project content";
    default:
      return "No permissions assigned";
  }
}
