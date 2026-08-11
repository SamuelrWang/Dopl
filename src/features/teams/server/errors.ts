import "server-only";
import { HttpError } from "@/shared/lib/http-error";

export class TeamNotFoundError extends HttpError {
  constructor() {
    super(404, "TEAM_NOT_FOUND", "Team not found");
  }
}
