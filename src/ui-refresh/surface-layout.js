import { fitBoard, placePopup } from './model.js';
import { applyGuideBand, guidePortraitSize } from './guide.js';
import { chooseGuideBand } from './guide-band.js';
import { placeFlow } from './effect-flow.js';

// Screen geometry of a mounted match: board fit, card popup, floating effect flow,
// tutorial focus and the guide. It only measures and positions; it never acts.
// Each queue() starts a new geometry epoch, so a stale frame drops its work.
export function createSurfaceLayout({ root, session, scope, boardStyle, latest, requestFrame, disposed, guideLastPage = () => true, paginateGuide = () => {}, guideStep = () => null }) {
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
    // rem: the root font size, for sizes kept in relative units (the guide band's cap).
    const viewport = {left:0,top:0,width:html.clientWidth,height:html.clientHeight,rem:parseFloat(getComputedStyle(html).fontSize) || 16};
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
    if (popup) {
      popup.style.maxWidth = `${Math.max(0,popupBounds.width-16)}px`;
      popup.style.maxHeight = `${Math.max(0,popupBounds.height-16)}px`;
    }
    const popupMeasure = popup && anchor ? {
      popup, position: placePopup(anchor.getBoundingClientRect(), popup.getBoundingClientRect(), popupBounds)
    } : null;
    if (popupMeasure) {
      const height = popup.getBoundingClientRect().height;
      popupMeasure.position.top = Math.max(popupBounds.top+8,Math.min(popupMeasure.position.top,popupBounds.bottom-height-8));
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
    if (tutorial.ok && !tutorial.value.flow.complete) for (const focus of tutorial.value.presentation.focus ?? []) {
      const seat = scope.seatIds[focus.owner === 'ai' ? 1 : 0];
      const selectors = {card:`[data-card-id="${focus.cardId}"][data-seat="${seat}"][data-zone="${focus.zone}"]`,
        zone:`.zone[data-seat="${seat}"][data-zone="${focus.zone}"]`,fortress:`[data-fortress="${seat}"]`,
        admin:`[data-runtime-zone="${focus.zone}"][data-seat="${seat}"]`,action:focus.action === 'tutorial-advance' ? '[data-runtime-tutorial-next]' : '[data-runtime-end-turn]',
        // A HUD control, or a part of the card detail while it shows the focused card.
        ui:{'info-button':'[data-runtime-counts]','card-detail':`.r2-detail[data-card-id="${focus.cardId}"]`,
          'ability-badge':`.r2-detail[data-card-id="${focus.cardId}"] [data-ability-help]`}[focus.target],
        // A route button in the popup of the focused card (play = execute).
        button:focus.button === 'play' ? `.r2-popup[data-card-id="${focus.cardId}"] :is([data-route="executeCard"],[data-route="executeSpell"])` : null};
      const named = element => !focus.badge || [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].some(text => text?.includes(focus.badge));
      for (const element of [...root.querySelectorAll(selectors[focus.kind] ?? ':not(*)')].filter(named)) {
        pointed.push(element);
        if (!guideLastPage()) continue;
        element.classList.add('live-focus');element.dataset.tutorialFocusLabel = focus.label;
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
      const key = `${guideStep()}|${viewport.width}x${viewport.height}|${rects.length}`;
      if (guideBand.key !== key) guideBand = { key, band: chooseGuideBand(viewport, rects, tutorial.ok ? tutorial.value.presentation.band : null, { portrait: guidePortraitSize(viewport) }) };
      applyGuideBand(view, guideBand.band, viewport);
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
