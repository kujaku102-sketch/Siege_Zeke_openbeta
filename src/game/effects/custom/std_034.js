import { isObCard } from "../../card-types.js";

export function std034ResponseCardApplicable({ opponent }) {
  return [...opponent.front, ...opponent.back].some(isObCard);
}
