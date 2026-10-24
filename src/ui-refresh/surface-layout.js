import { fitBoard, placePopup, avoidFocus } from './model.js';
import { prepareGuideContent, measureGuideContent, commitGuideContent } from './guide.js';
import { placeFlow } from './effect-flow.js';

// Screen geometry of a mounted match: board fit, card popup, floating effect flow,
// tutorial focus and the guide. It only measures and positions; it never acts.
// Each queue() starts a new geometry epoch, so a stale frame drops its work.
export function createSurfaceLayout({ root, session, scope, boardStyle, latest, requestFrame, disposed }) {
  let layoutFrame = null;
  let guideMeasureFrame = null;
  let guidePositionFrame = null;
  let guideViewport = null;
  let geometryEpoch = 0;
  const queueGuidePosition = epoch => {
    if (disposed() || guidePositionFrame !== null) return;
    guidePositionFrame = requestFrame(() => {
      guidePositionFrame = null;
      if (disposed() || epoch !== geometryEpoch) return;
      const guide = root.querySelector('.live-guide');
      if (!guide) return;
      const viewport = {left:0,top:0,width:root.ownerDocument.documentElement.clientWidth,height:root.ownerDocument.documentElement.clientHeight};
      const targets = [...root.querySelectorAll('.live-focus,.r2-detail,.r2-console,.r2-popup')].map(element => element.getBoundingClientRect());
      const position = avoidFocus(guide.getBoundingClientRect(),targets,viewport);
      guide.style.left = `${position.left}px`;guide.style.top = `${position.top}px`;
    });
  };
  const queueGuideMeasurement = epoch => {
    if (disposed() || guideMeasureFrame !== null) return;
    guideMeasureFrame = requestFrame(() => {
      guideMeasureFrame = null;
      if (disposed()) return;
      if (epoch !== geometryEpoch) { queueGuideMeasurement(geometryEpoch); return; }
      const guide = root.querySelector('.live-guide');
      if (!guide || !guideViewport) return;
      const width = measureGuideContent(guide,guideViewport);
      commitGuideContent(guide,width);
      queueGuidePosition(epoch);
    });
  };
  const layout = epoch => {
    if (disposed() || epoch !== geometryEpoch) return;
    const stage = root.querySelector('.r2-stage'), board = root.querySelector('.r2-board');
    const canvas = root.querySelector('.r2-board-fit'), contents = root.querySelector('.battle-board');
    const viewport = {left:0,top:0,width:root.ownerDocument.documentElement.clientWidth,height:root.ownerDocument.documentElement.clientHeight};
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
    if (tutorial.ok && !tutorial.value.flow.complete) for (const focus of tutorial.value.presentation.focus ?? []) {
      const seat = scope.seatIds[focus.owner === 'ai' ? 1 : 0];
      const selectors = {card:`[data-card-id="${focus.cardId}"][data-seat="${seat}"][data-zone="${focus.zone}"]`,
        zone:`.zone[data-seat="${seat}"][data-zone="${focus.zone}"]`,fortress:`[data-fortress="${seat}"]`,
        admin:`[data-runtime-zone="${focus.zone}"][data-seat="${seat}"]`,action:focus.action === 'tutorial-advance' ? '[data-runtime-tutorial-next]' : '[data-runtime-end-turn]'};
      for (const element of root.querySelectorAll(selectors[focus.kind] ?? ':not(*)')) {
        element.classList.add('live-focus');element.dataset.tutorialFocusLabel = focus.label;
      }
    }
    const guide = root.querySelector('.live-guide');
    if (guide) {
      guideViewport = viewport;
      prepareGuideContent(guide,guideViewport);
      queueGuideMeasurement(epoch);
    }
  };
  const queueLayout = () => {
    geometryEpoch += 1;
    if (disposed() || layoutFrame !== null) return;
    layoutFrame = requestFrame(() => { layoutFrame = null; if (!disposed()) layout(geometryEpoch); });
  };
  return Object.freeze({
    queue: queueLayout,
    dispose() { geometryEpoch += 1; layoutFrame = null; guideMeasureFrame = null; guidePositionFrame = null; }
  });
}
