// The way back from Discord (design: サーバー設計-Discordログイン.md §2): the page that asked kept its address for the trip
// (src/ui-refresh/online-login.js, RETURN_KEY); the answer's fields go back to it, and that page finishes the login.
(() => {
  const ANSWER = ["code", "state", "error", "error_description", "iss"];
  let back = null;
  try { back = JSON.parse(sessionStorage.getItem("sz-discord-return") || "null"); sessionStorage.removeItem("sz-discord-return"); } catch { back = null; }
  const path = back && typeof back.path === "string" && back.path.startsWith("/") && !back.path.startsWith("//") ? back.path : "/";
  const params = new URLSearchParams(back && typeof back.search === "string" ? back.search : "");
  for (const [key, value] of new URLSearchParams(location.search)) if (ANSWER.includes(key)) params.set(key, value);
  const query = params.toString();
  location.replace(`${path}${query ? `?${query}` : ""}`);
})();
