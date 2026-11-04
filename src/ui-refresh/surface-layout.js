import { fitBoard, placePopup } from './model.js';
import { applyGuideBand, guideMinFrame, guideNavHeight, GUIDE_PORTRAIT_ASPECT } from './guide.js';
import { chooseGuidePlacement } from './guide-band.js';
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
// The step's grow with its cut height ((i), fit) never below the buttons' column (px; 0 where they share the name's line).
const withButtons = (grow, buttons) => grow.fit > 0 && buttons > grow.fit ? { ...grow, fit: buttons } : grow;
const expectedButton = expect => expect?.type === 'answerChoice' && expect.cardId ? [{ kind: 'option', cardId: expect.cardId }]
  : EXPECTED_ROUTES[expect?.type] && expect.cardId ? [{ kind: 'route', cardId: expect.cardId, routes: EXPECTED_ROUTES[expect.type] }] : [];

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
    // A refused move's notice sits just above the hand (the shell draws it, outside this root): the hand's top as it
    // stands now, raised or lowered, as a share of the screen's height.
    const handHost = root.querySelector('.r2-hand-host'), content = root.closest?.('.r2-content');
    if (handHost && content) content.style.setProperty('--live-hand-rise', `${Math.max(0, (viewport.height - handHost.getBoundingClientRect().top) / viewport.height * 100)}%`);
    const tutorial = session.tutorial();
    // A popup or detail kept open across steps would keep the last step's marks: clear them first.
    for (const element of root.querySelectorAll('.live-focus')) { element.classList.remove('live-focus'); delete element.dataset.tutorialFocusLabel; }
    // What the step points at is found on every page (the guide keeps clear of it), but marked only on the last.
    const pointed = [];
    // The next step's marks wait with its line while the opponent's script plays.
    if (tutorial.ok && !tutorial.value.flow.complete && !tutorial.value.opponentScript) for (const focus of [...tutorial.value.presentation.focus ?? [], ...expectedButton(tutorial.value.presentation.expect)]) {
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
    const flow = root.querySelector('[data-live-region="selection"] > .effect-flow');
    const shown = elements => elements.map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
    if (guide && view) {
      // What a pick asks the player to press is kept clear as well as the step's highlights, and the floating effect
      // flow with them (文豪, 2026-11-03, H7).
      const picks = [...root.querySelectorAll('.request-target,.runtime-selection-option,[data-runtime-confirm],[data-runtime-back],[data-runtime-decline]'), ...(flow ? [flow] : [])];
      // The guide's own controls ([開始], [次へ]) move with it: no band covers them (文豪, 2026-11-04, 1a).
      const rects = shown([...pointed, ...picks].filter(element => !guide.contains(element)));
      // A portrait hidden under an open panel (live.css) covers nothing (文豪, 2026-11-04, blue #15).
      const cast = guide.querySelector('.live-guide-cast :is(img,.live-guide-noportrait)');
      const portrait = Boolean(cast) && getComputedStyle(cast).visibility !== 'hidden';
      // Then, where it can, the opponent's board, TURN and the memory stay in sight (文豪, 2026-11-03, H1).
      const viewer = latest()?.model.match.viewerSeat, opponent = scope.seatIds.find(seat => seat !== viewer);
      const keep = shown([...root.querySelectorAll(`[data-live-region="board"] :is([data-seat="${opponent}"],[data-fortress="${opponent}"],[data-fx-seat="${opponent}"]),[data-runtime-end-turn],.wf-meter,.wf-memory`)]);
      // A page too long for a third of the screen grows the frame (文豪, 2026-10-28): the band keeps clear with the
      // step's tallest page, and the page shown gets its own height.
      // A frame cut to its line keeps a phone's button column inside it (文豪, 2026-11-04).
      const grow = withButtons(guideGrow(), guideNavHeight(guide));
      // The frame ends before the HUD column at the right, TURN and the memory, as the share of the screen's width it
      // takes on this screen (文豪, 2026-11-04, 1b); a HUD not standing at the right edge keeps nothing free.
      const hud = shown([...root.querySelectorAll('[data-runtime-end-turn],.wf-memory')]);
      const hudLeft = hud.length && Math.max(...hud.map(rect => rect.right)) >= viewport.width * .9 ? Math.min(...hud.map(rect => rect.left)) : viewport.width;
      const reserve = Math.round(Math.max(0, viewport.width - hudLeft) / viewport.width * 1000) / 1000;
      // A step no band keeps clear of cuts the frame to its line, and is weighed again (文豪, 2026-11-04, (i)).
      const key = `${guideStep()}|${viewport.width}x${viewport.height}|${rects.length}|${Math.round(grow.step)}|${portrait}|${reserve}|${Math.round(grow.fit ?? 0)}`;
      // Where the frame beside the portrait would hold less than GUIDE_MIN_LINE_EM a line, the portrait's column
      // narrows to the chest up (文豪, 2026-11-04, C: 4:3 screens).
      const minFrame = guideMinFrame(guide);
      if (guideBand.key !== key) guideBand = { key, ...chooseGuidePlacement(viewport, rects, tutorial.ok ? tutorial.value.presentation.band : null, { aspect: GUIDE_PORTRAIT_ASPECT, grow: grow.step, keep, portrait, reserve, fit: grow.fit, minFrame }) };
      applyGuideBand(view, guideBand.band, viewport, grow.page, { reserve, fit: guideBand.fit ? grow.fit : null, minFrame });
      paginateGuide(guide);
    }
    // A floating effect flow keeps clear of the pick's targets and its prompt, and of the guide where it now stands.
    if (flow) {
      const obstacles = shown([...root.querySelectorAll('.request-target,.board-pick-guide,.r2-console,.r2-popup,.live-guide .live-guide-speech,.live-guide .live-guide-cast :is(img,.live-guide-noportrait)')]);
      const position = placeFlow(flow.getBoundingClientRect(), obstacles, viewport);
      flow.style.left = `${position.left}px`; flow.style.top = `${position.top}px`;
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
