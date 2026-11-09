// A match in the 'ai' mode starts the first player's turn at once, and since 2.0-public-staging.20 that turn draws a card (2026-11-09): a fixture that built the match with an
// empty deck would now lose at the first draw. It builds the match with this deck instead: the opening hand of 4 and the first draw of 1, FILLER_HAND cards in the first player's hand.
export const FILLER_HAND = 5;
export const FILLER_RECIPE = [['STD-001', FILLER_HAND]];
