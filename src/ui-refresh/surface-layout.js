import { fitBoard, placePopup } from './model.js';
import { applyGuideBand, GUIDE_PORTRAIT_ASPECT } from './guide.js';
import { chooseGuideBand } from './guide-band.js';
import { placeFlow } from './effect-flow.js';
import { screenUnit } from './screen-unit.js';

// Screen geometry of a mounted match: board fit, card popup, floating effect flow,
// tutorial focus and the guide. It only measures and positions; it never acts.
// Each queue() starts a new geometry epoch, so a stale frame drops its work.

// The popup button a tutorial step asks the player to press (its expect), by route (文豪, 2026-10-28): pointed at
// once the card's popup is open, so the guide keeps clear of it like any other highlight. A popup merely left open
// is not pointed at.
const EXPECTED_ROUTES = Object.freeze({ play: ['executeCard', 'executeSpell', 'mountCard', 'setScript'], install: ['install'],
  attack: ['attack'], layered: ['executeLayered'], relog: ['redeploy'], 'activate-effect': ['activateCardEffect'] });
// A step that asks for a choice's answer points at the option of its card (blue: the access pick of the Offense Protocol).
const expectedButton = expect => expect?.type === 'answerChoice' && expect.cardId ? [{ kind: 'option', cardId: expect.cardId }]
  : EXPECTED_ROUTES[expect?.type] && expect.cardId ? [{ kind: 'route', cardId: expect.cardId, routes: EXPECTED_ROUTES[expect.type] }] : [];

// The card detail sits at the screen's left edge, where the guide's portrait stands: a badge the line points at is
// scrolled within the detail to a free side of the portrait it can reach, the nearer one (blue: the Hacking badge
// while it is explained). Where neither can be reached it stays as it is.
function clearOfPortrait(guide, badge, viewport) {
  const portrait = guide.querySelector('.live-guide-cast img,.live-guide-noportrait')?.getBoundingClientRect();
  if (!badge || !portrait) return;
  const rect = badge.getBoundingClientRect();
  if (rect.right <= portrait.left || rect.left >= portrait.right || rect.bottom <= portrait.top || rect.top >= portrait.bottom) return;
  let scroller = badge.parentElement;
  while (scroller && scroller.scrollHeight <= scroller.clientHeight && !scroller.matches('.r2-detail')) scroller = scroller.parentElement;
  if (!scroller) return;
  const box = scroller.getBoundingClientRect(), gap = viewport.height * .02;
  const room = { up: scroller.scrollTop, down: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop };
  // How far to scroll (+ down the content) so the badge sits just below or just above the portrait, inside the detail.
  const moves = [rect.top - (portrait.bottom + gap), rect.bottom - (portrait.top - gap)]
    .filter(move => (move < 0 ? -move <= room.up : move <= room.down) && rect.top - move >= box.top && rect.bottom - move <= box.bottom);
  if (moves.length) scroller.scrollTop += moves.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
}

export function createSurfaceLayout({ root, session, scope, boardStyle, latest, requestFrame, disposed, guideLastPage = () => true, paginateGuide = () => {}, guideStep = () => null, guideGrow = () => ({ page: 0, step: 0 }) }) {
  let layoutFrame = null;
  let scrolledFocus = null;
  let geometryEpoch = 0;
  // The guide's band is chosen once a step and kept while its pages turn; it is chosen again only when the
  // step changes or what the step points at appears or goes (a card detail or a popup opened for it).
  let guideBand = { key: null, band: null };
  const layout = epoch => {
    if (disposed() || epoch !== geometryEpoch) return;
    const stage = root.querySelector('.r2-stage'), board = root.querySelector('.r2-board');
    const canvas = root.querySelector('.r2-board-fit'), contents = root.querySelector('.battle-board');
    const html = root.ownerDocument.documentElement;
    const viewport = {left:0,top:0,width:html.clientWidth,height:html.clientHeight};
    const boardMeasure = stage && board && canvas && contents ? {
      size: fitBoard(stage.clientWidth, stage.clientHeight),
      height: Math.max(1, contents.offsetHeight)
    } : null;
    const popup = root.querySelector('.r2-popup');
    const selected = latest()?.model.ui.selectedCardRef;
    const anchor = selected && [...root.querySelectorAll('.card[data-card-ref],.wf-slot[data-card-ref]')]
      .find(node => node.dataset.cardRef === selected && (boardStyle !== 'wireframe'
        || (node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)));
    // A collapsed hand/drawer has no screen position. Keep the draft, but do not
    // relocate its popup to the zero-size hidden anchor (over the menu gear).
    if (popup) popup.style.visibility = anchor ? '' : 'hidden';
    const referenceList = anchor?.closest('.wf-drawer .admin-card-list');
    const popupBounds = referenceList?.getBoundingClientRect() ?? root.getBoundingClientRect();
    // The popup keeps half a screen unit (--u) from the edges.
    const margin = popup ? screenUnit(root.ownerDocument) * .5 : 0;
    if (popup) {
      popup.style.maxWidth = `${Math.max(0,popupBounds.width-margin*2)}px`;
      popup.style.maxHeight = `${Math.max(0,popupBounds.height-margin*2)}px`;
    }
    const popupMeasure = popup && anchor ? {
      popup, position: placePopup(anchor.getBoundingClientRect(), popup.getBoundingClientRect(), popupBounds, margin)
    } : null;
    if (popupMeasure) {
      const height = popup.getBoundingClientRect().height;
      popupMeasure.position.top = Math.max(popupBounds.top+margin,Math.min(popupMeasure.position.top,popupBounds.bottom-height-margin));
    }
    if (boardMeasure) {
      const {size,height} = boardMeasure;
      board.style.width = `${size.width}px`; board.style.height = `${size.height}px`;
      canvas.style.height = `${height}px`;
      canvas.style.transform = `translate(-50%, -50%) scale(${Math.min(size.width / 1000, size.height / height)})`;
    }
    if (popupMeasure) {
      popupMeasure.popup.style.left = `${popupMeasure.position.left}px`;
      popupMeasure.popup.style.top = `${popupMeasure.position.top}px`;
    }
    // A floating effect flow keeps clear of the pick's targets and its prompt.
    const flow = root.querySelector('[data-live-region="selection"] > .effect-flow');
    if (flow) {
      const obstacles = [...root.querySelectorAll('.request-target,.board-pick-guide,.r2-console,.r2-popup')]
        .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
      const position = placeFlow(flow.getBoundingClientRect(), obstacles, viewport);
      flow.style.left = `${position.left}px`; flow.style.top = `${position.top}px`;
    }
    const tutorial = session.tutorial();
    // A popup or detail kept open across steps would keep the last step's marks: clear them first.
    for (const element of root.querySelectorAll('.live-focus')) { element.classList.remove('live-focus'); delete element.dataset.tutorialFocusLabel; }
    // What the step points at is found on every page (the guide keeps clear of it), but marked only on the last.
    const pointed = [];
    if (tutorial.ok && !tutorial.value.flow.complete) for (const focus of [...tutorial.value.presentation.focus ?? [], ...expectedButton(tutorial.value.presentation.expect)]) {
      const seat = scope.seatIds[focus.owner === 'ai' ? 1 : 0];
      const selectors = {card:`[data-card-id="${focus.cardId}"][data-seat="${seat}"][data-zone="${focus.zone}"]`,
        // A zone on the 3D board has no box of its own: its empty slots stand for it.
        zone:`:is(.zone,.wire-board .board-slot:not([data-card-ref]))[data-seat="${seat}"][data-zone="${focus.zone}"]`,fortress:`[data-fortress="${seat}"]`,
        admin:`[data-runtime-zone="${focus.zone}"][data-seat="${seat}"]`,action:focus.action === 'tutorial-advance' ? '[data-runtime-tutorial-next]' : '[data-runtime-end-turn]',
        // A HUD control, or a part of the card detail while it shows the focused card.
        ui:{'info-button':'[data-runtime-counts]','card-detail':`.r2-detail[data-card-id="${focus.cardId}"]`,
          'ability-badge':`.r2-detail[data-card-id="${focus.cardId}"] [data-ability-help]`}[focus.target],
        // A route button in the popup of the focused card (play = execute).
        button:focus.button === 'play' ? `.r2-popup[data-card-id="${focus.cardId}"] :is([data-route="executeCard"],[data-route="executeSpell"])` : null,
        route:focus.routes ? `.r2-popup[data-card-id="${focus.cardId}"] :is(${focus.routes.map(route => `[data-route="${route}"]`).join(',')})` : null,
        option:`[data-option-card-id="${focus.cardId}"]`};
      const named = element => !focus.badge || [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].some(text => text?.includes(focus.badge));
      for (const element of [...root.querySelectorAll(selectors[focus.kind] ?? ':not(*)')].filter(named)) {
        pointed.push(element);
        if (!guideLastPage()) continue;
        element.classList.add('live-focus');element.dataset.tutorialFocusLabel = focus.label ?? element.textContent.trim();
        // The card detail scrolls; on a short screen its ability buttons sit below the fold. Centred, so the
        // highlight's outline is not cut by the panel's edge.
        const key = `${tutorial.value.flow.index}:${focus.target}`;
        if (focus.kind === 'ui' && focus.target === 'ability-badge' && scrolledFocus !== key) { scrolledFocus = key; element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
      }
    }
    const guide = root.querySelector('.live-guide'), view = root.querySelector('.r2-runtime-view');
    if (guide && view) {
      // What a pick asks the player to press is kept clear as well as the step's highlights.
      const picks = [...root.querySelectorAll('.request-target,.runtime-selection-option,[data-runtime-confirm],[data-runtime-back],[data-runtime-decline]')];
      const rects = [...pointed, ...picks].map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
      // A page too long for a third of the screen grows the frame (文豪, 2026-10-28): the band keeps clear with the
      // step's tallest page, and the page shown gets its own height.
      const grow = guideGrow();
      const key = `${guideStep()}|${viewport.width}x${viewport.height}|${rects.length}|${Math.round(grow.step)}`;
      if (guideBand.key !== key) guideBand = { key, band: chooseGuideBand(viewport, rects, tutorial.ok ? tutorial.value.presentation.band : null, { aspect: GUIDE_PORTRAIT_ASPECT, grow: grow.step }) };
      applyGuideBand(view, guideBand.band, viewport, grow.page);
      clearOfPortrait(guide, pointed.find(element => element.matches('.r2-detail [data-ability-help]')), viewport);
      paginateGuide(guide);
    }
  };
  const queueLayout = () => {
    geometryEpoch += 1;
    if (disposed() || layoutFrame !== null) return;
    layoutFrame = requestFrame(() => { layoutFrame = null; if (!disposed()) layout(geometryEpoch); });
  };
  return Object.freeze({
    queue: queueLayout,
    dispose() { geometryEpoch += 1; layoutFrame = null; }
  });
}
