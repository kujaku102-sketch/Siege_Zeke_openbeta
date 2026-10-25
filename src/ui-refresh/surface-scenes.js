import { attachBoardCamera } from './wireframe/camera.js';
import { wireframePreviewHtml, fitPixelLines } from './wireframe/board-view.js';
import { createBoardScene } from './wireframe/board-scene.js';
import { attachLifeView } from './wireframe/life-view.js';
import { createHudScene } from './wireframe/hud-scene.js';

// The drawn parts of a mounted match that live outside the HTML: the wireframe
// camera, its 3D board and hover preview, the PS1 turn/hex buttons and the life view.
// Each is re-attached when a re-render replaces its host node.
// `lowGpu` (compat render mode) keeps the board and HUD in their SVG/CSS form: no WebGL context is
// made. It can change during a match (setLowGpu); a lost context is reported through onContextLost.
export function createSurfaceScenes({ root, boardStyle, renderQuality, latest, lowGpu = false, onContextLost = () => {} }) {
  let boardCamera = null, cameraNode = null, boardHover = null;
  let boardScene = null, lifeView = null, sceneNode = null;
  let hudScene = null, hudNode = null, hudSynced = null;
  // Each host node gets one attempt at a WebGL scene per mode, so a failing context is not retried every render.
  let boardTried = null, hudTried = null;
  // A lost WebGL context hides the drawn form (SVG/CSS take over) until the browser restores it.
  let boardUsable = true, hudUsable = true;
  const markBoard = () => root.querySelector('.wire-board-host')?.classList.toggle('wf-has-model', Boolean(boardScene) && boardUsable);
  const markHud = () => root.querySelector('.wf-hud-model')?.parentElement?.classList.toggle('wf-hud-rendered', Boolean(hudScene) && hudUsable);
  const lost = usable => { if (!usable) onContextLost(); };
  const fitLines = event => fitPixelLines(event.currentTarget);
  const updateWirePreview = () => {
    const overlay = root.querySelector('.wf-preview');
    if (overlay && latest()) overlay.innerHTML = wireframePreviewHtml(latest(),boardHover);
  };
  return Object.freeze({
    // `redraw` is false for a UI-local render: the board, its camera and the HUD canvases
    // then keep what they drew, since only the runtime state or the hosts change them.
    sync(next, effectsEnabled, redraw = true) {
      if (boardStyle === 'wireframe') {
        const svg = root.querySelector('.wire-board');
        if (svg !== cameraNode) {
          boardScene?.dispose();boardScene=null;
          cameraNode?.removeEventListener('board-camera-change',fitLines);
          boardCamera?.dispose(); cameraNode = svg;
          svg?.addEventListener('board-camera-change',fitLines);
          boardCamera = svg ? attachBoardCamera(svg) : null;
          boardUsable = true;
        }
        if(svg && !lowGpu && !boardScene && boardTried !== svg){
          boardTried = svg;
          try { boardScene=createBoardScene(root.querySelector('.wf-board-model'),svg,renderQuality,{onUsable:usable => { boardUsable = usable; markBoard(); lost(usable); }}); }
          catch { /* SVG remains a complete operable fallback without WebGL. */ }
        }
        markBoard();
        const fresh = redraw || svg !== sceneNode;
        sceneNode = svg;
        if (fresh) { boardScene?.sync(next.model); boardCamera?.refresh(); fitPixelLines(svg); }
        updateWirePreview();
      }
      // Everything around the board is the same kit on both boards.
      const hudCanvas=root.querySelector('.wf-hud-model');
      if(hudNode!==hudCanvas){
        hudScene?.dispose();hudScene=null;hudNode=hudCanvas;hudUsable=true;
      }
      if(hudCanvas && !lowGpu && !hudScene && hudTried !== hudCanvas){
        hudTried = hudCanvas;
        try{hudScene=createHudScene(hudCanvas,renderQuality,{onUsable:usable => { hudUsable = usable; markHud(); lost(usable); }});}catch{/* The CSS buttons stay as they are. */}
      }
      markHud();
      const hudFresh = redraw || !lifeView || hudCanvas !== hudSynced;
      hudSynced = hudCanvas;
      if (hudFresh) {
        hudScene?.sync(root,effectsEnabled);
        lifeView??=attachLifeView(root,renderQuality);lifeView.sync(next.model,effectsEnabled);
      }
    },
    // Compat drops the WebGL board and HUD at once; full lets the next sync draw them again.
    setLowGpu(value) {
      if (lowGpu === Boolean(value)) return;
      lowGpu = Boolean(value);
      if (lowGpu) { boardScene?.dispose(); boardScene = null; hudScene?.dispose(); hudScene = null; markBoard(); markHud(); }
      else { boardTried = null; hudTried = null; boardUsable = true; hudUsable = true; sceneNode = null; hudSynced = null; }
    },
    // Forgets the hovered board target without redrawing the preview.
    dropHover() { boardHover = null; },
    clearHover() { boardHover = null; updateWirePreview(); },
    hover(node) {
      if (boardStyle !== 'wireframe') return;
      boardHover = node?.dataset.cardRef ? {kind:'card',cardRef:node.dataset.cardRef}
        : node?.dataset.slot ? {kind:'slot',seatId:node.dataset.seat,zone:node.dataset.zone,slot:Number(node.dataset.slot)}
        : node?.dataset.fortress ? {kind:'user',seatId:node.dataset.fortress} : null;
      updateWirePreview();
    },
    dispose() {
      cameraNode?.removeEventListener('board-camera-change',fitLines);
      boardCamera?.dispose(); boardScene?.dispose();lifeView?.dispose();boardCamera = null; boardScene=null;lifeView=null;cameraNode = null;
      hudScene?.dispose();hudScene=null;hudNode=null;
    }
  });
}
