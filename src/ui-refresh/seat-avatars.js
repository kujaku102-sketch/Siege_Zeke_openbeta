// The players' pictures in the board's two circles, the player's bottom left and the opponent's top right (an online match
// with a Discord login, design サーバー設計-Discordログイン.md §7, Q5): a still picture over the circle, asked for without
// telling Discord which site shows it. With none, or one that cannot be read, the circle keeps its own colour.
const failed = new Set();

// avatars: { self, opponent }, each an address or null. Run after every redraw of the board (it may rebuild the circles).
export function syncSeatAvatars(root, avatars) {
  for (const [side, address] of [["wf-self", avatars?.self], ["wf-enemy", avatars?.opponent]]) {
    const circle = root?.querySelector(`.${side} .wf-avatar`);
    if (!circle) continue;
    const wanted = typeof address === "string" && address !== "" && !failed.has(address) ? address : null;
    const shown = circle.querySelector("img.wf-avatar-img");
    if (!wanted) { shown?.remove(); continue; }
    if (shown?.getAttribute("src") === wanted) continue;
    shown?.remove();
    const picture = circle.ownerDocument.createElement("img");
    picture.className = "wf-avatar-img";
    picture.alt = "";
    picture.draggable = false;
    picture.decoding = "async";
    // The policy goes on before the address, so the request already carries it.
    picture.setAttribute("referrerpolicy", "no-referrer");
    picture.addEventListener("error", () => { failed.add(wanted); picture.remove(); }, { once: true });
    picture.src = wanted;
    circle.append(picture);
  }
}
