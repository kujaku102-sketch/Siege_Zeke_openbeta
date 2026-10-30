import * as sztb_090 from "./sztb/sztb_090.js";
import * as sztb_091 from "./sztb/sztb_091.js";
import * as sztb_092 from "./sztb/sztb_092.js";
import * as sztb_093 from "./sztb/sztb_093.js";
import * as sztb_094 from "./sztb/sztb_094.js";
import * as sztb_095 from "./sztb/sztb_095.js";
import * as sztb_096 from "./sztb/sztb_096.js";
import * as sztb_097 from "./sztb/sztb_097.js";
import * as sztb_098 from "./sztb/sztb_098.js";
import * as sztb_099 from "./sztb/sztb_099.js";
import * as sztb_100 from "./sztb/sztb_100.js";
import * as sztb_101 from "./sztb/sztb_101.js";
import * as sztb_102 from "./sztb/sztb_102.js";

// SZTB index: card id -> card module (one file per card, in library order)
export const SZTB_CARD_MODULES = Object.freeze({
  "SZTB-090": sztb_090,
  "SZTB-091": sztb_091,
  "SZTB-092": sztb_092,
  "SZTB-093": sztb_093,
  "SZTB-094": sztb_094,
  "SZTB-095": sztb_095,
  "SZTB-096": sztb_096,
  "SZTB-097": sztb_097,
  "SZTB-098": sztb_098,
  "SZTB-099": sztb_099,
  "SZTB-100": sztb_100,
  "SZTB-101": sztb_101,
  "SZTB-102": sztb_102
});

// SZTB card definitions in the same order
export const SZTB_CARDS = Object.freeze({
  "SZTB-090": sztb_090.definition,
  "SZTB-091": sztb_091.definition,
  "SZTB-092": sztb_092.definition,
  "SZTB-093": sztb_093.definition,
  "SZTB-094": sztb_094.definition,
  "SZTB-095": sztb_095.definition,
  "SZTB-096": sztb_096.definition,
  "SZTB-097": sztb_097.definition,
  "SZTB-098": sztb_098.definition,
  "SZTB-099": sztb_099.definition,
  "SZTB-100": sztb_100.definition,
  "SZTB-101": sztb_101.definition,
  "SZTB-102": sztb_102.definition
});
