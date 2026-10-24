import { attachBoardCamera } from './wireframe/camera.js';
import { wireframePreviewHtml, fitPixelLines } from './wireframe/board-view.js';
import { createBoardScene } from './wireframe/board-scene.js';
import { attachLifeView } from './wireframe/life-view.js';
import { createHudScene } from './wireframe/hud-scene.js';

// The drawn parts of a mounted match that live outside the HTML: the wireframe
// camera, its 3D board and hover preview, the PS1 turn/hex buttons and the life view.
// Each is re-attached when a re-render replaces its host node.
export function createSurfaceScenes({ root, boardStyle, renderQuality, latest }) {
  let boardCamera = null, cameraNode = null, boardHover = null;
  let boardScene = null, lifeView = null, sceneNode = null;
  let hudScene = null, hudNode = null, hudSynced = null;
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
          if(svg){
            try { boardScene=createBoardScene(root.querySelector('.wf-board-model'),svg,renderQuality); }
            catch { /* SVG remains a complete operable fallback without WebGL. */ }
          }
        }
        root.querySelector('.wire-board-host')?.classList.toggle('wf-has-model',Boolean(boardScene));
        const fresh = redraw || svg !== sceneNode;
        sceneNode = svg;
        if (fresh) { boardScene?.sync(next.model); boardCamera?.refresh(); fitPixelLines(svg); }
        updateWirePreview();
      }
      // Everything around the board is the same kit on both boards.
      const hudCanvas=root.querySelector('.wf-hud-model');
      if(hudNode!==hudCanvas){
        hudScene?.dispose();hudScene=null;hudNode=hudCanvas;
        if(hudCanvas)try{hudScene=createHudScene(hudCanvas,renderQuality);}catch{/* The CSS buttons stay as they are. */}
      }
      hudCanvas?.parentElement.classList.toggle('wf-hud-rendered',Boolean(hudScene));
      const hudFresh = redraw || !lifeView || hudCanvas !== hudSynced;
      hudSynced = hudCanvas;
      if (hudFresh) {
        hudScene?.sync(root,effectsEnabled);
        lifeView??=attachLifeView(root,renderQuality);lifeView.sync(next.model,effectsEnabled);
      }
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
